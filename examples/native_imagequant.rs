use imagequant::{Attributes, Image, RGBA};
use png::{BitDepth, ColorType, Compression, Encoder, Filter};
use std::fs;
use std::io::Cursor;
use std::path::Path;

const WIDTH: usize = 100;
const HEIGHT: usize = 100;
const COLORS: usize = 16;
const SPEED: i32 = 3;

fn create_solid_red() -> Vec<RGBA> {
    (0..WIDTH * HEIGHT)
        .map(|_| RGBA::new(255, 0, 0, 255))
        .collect()
}

fn create_gradient() -> Vec<RGBA> {
    (0..HEIGHT)
        .flat_map(|y| {
            (0..WIDTH).map(move |x| {
                let r = ((x as f32 / WIDTH as f32) * 255.0) as u8;
                let g = ((y as f32 / HEIGHT as f32) * 255.0) as u8;
                let b = (((x + y) as f32 / (WIDTH + HEIGHT) as f32) * 255.0) as u8;
                RGBA::new(r, g, b, 255)
            })
        })
        .collect()
}

fn create_four_quadrants() -> Vec<RGBA> {
    (0..HEIGHT)
        .flat_map(|y| {
            (0..WIDTH).map(move |x| {
                let is_right = x >= WIDTH / 2;
                let is_bottom = y >= HEIGHT / 2;
                let (r, g, b, a) = if !is_right && !is_bottom {
                    (255, 0, 0, 255)
                } else if is_right && !is_bottom {
                    (0, 255, 0, 255)
                } else if !is_right && is_bottom {
                    (0, 0, 255, 255)
                } else {
                    (255, 255, 255, 255)
                };
                RGBA::new(r, g, b, a)
            })
        })
        .collect()
}

fn create_transparent() -> Vec<RGBA> {
    (0..HEIGHT)
        .flat_map(|_y| {
            (0..WIDTH).map(move |x| {
                let a = if x < WIDTH / 2 { 255 } else { 0 };
                RGBA::new(255, 0, 0, a)
            })
        })
        .collect()
}

fn optimal_bit_depth(palette_len: usize) -> BitDepth {
    if palette_len <= 2 {
        BitDepth::One
    } else if palette_len <= 4 {
        BitDepth::Two
    } else if palette_len <= 16 {
        BitDepth::Four
    } else {
        BitDepth::Eight
    }
}

fn pack_indices(indices: &[u8], width: usize, height: usize, bit_depth: BitDepth) -> Vec<u8> {
    let bits_per_pixel = bit_depth as u8 as usize;
    let indices_per_byte = 8 / bits_per_pixel;
    let bytes_per_row = (width * bits_per_pixel + 7) / 8;
    let mut packed = vec![0u8; height * bytes_per_row];

    for y in 0..height {
        let row_offset = y * bytes_per_row;
        for x in 0..width {
            let index = indices[y * width + x];
            let byte_index = row_offset + x / indices_per_byte;
            let bit_shift = (8 - bits_per_pixel - (x % indices_per_byte) * bits_per_pixel) as u32;
            packed[byte_index] |= index << bit_shift;
        }
    }

    packed
}

fn encode_palette_png(
    indices: &[u8],
    palette: &[[u8; 4]],
    width: u32,
    height: u32,
    compression_level: u8,
) -> Vec<u8> {
    let mut png_data = Vec::new();
    {
        let mut encoder = Encoder::new(Cursor::new(&mut png_data), width, height);
        encoder.set_color(ColorType::Indexed);

        let bit_depth = optimal_bit_depth(palette.len());
        encoder.set_depth(bit_depth);

        let compression = match compression_level {
            0 => Compression::NoCompression,
            1..=2 => Compression::Fastest,
            3..=5 => Compression::Fast,
            6..=7 => Compression::Balanced,
            _ => Compression::High,
        };
        encoder.set_compression(compression);
        encoder.set_filter(Filter::NoFilter);

        let mut palette_rgb = Vec::new();
        let mut all_alpha = Vec::new();
        for color in palette {
            palette_rgb.extend_from_slice(&[color[0], color[1], color[2]]);
            all_alpha.push(color[3]);
        }

        encoder.set_palette(palette_rgb);
        if let Some(last_non_opaque) = all_alpha.iter().rposition(|&a| a < 255) {
            encoder.set_trns(all_alpha[..=last_non_opaque].to_vec());
        }

        let mut writer = encoder.write_header().unwrap();
        let packed = pack_indices(indices, width as usize, height as usize, bit_depth);
        writer.write_image_data(&packed).unwrap();
    }
    png_data
}

fn quantize_and_save(
    name: &str,
    pixels: &[RGBA],
    out_dir: &Path,
    dithering: f32,
) {
    let mut attr = Attributes::new();
    attr.set_speed(SPEED).unwrap();
    attr.set_quality(0, 100).unwrap();
    attr.set_max_colors(COLORS as u32).unwrap();

    let mut img = Image::new(&mut attr, pixels.to_vec().into_boxed_slice(), WIDTH, HEIGHT, 0.0)
        .unwrap();

    let mut result = attr.quantize(&mut img).unwrap();
    result.set_dithering_level(dithering).unwrap();

    let palette: Vec<_> = result
        .palette()
        .iter()
        .map(|c| [c.r, c.g, c.b, c.a])
        .collect();

    let (_, indices) = result.remapped(&mut img).unwrap();
    let quality = result.quantization_quality();

    let png_bytes = encode_palette_png(&indices, &palette, WIDTH as u32, HEIGHT as u32, 9);

    let label = if dithering == 0.0 { "nofs" } else { "dither" };
    let out_path = out_dir.join(format!("{}-{}-native-rust.png", name, label));
    fs::write(&out_path, &png_bytes).unwrap();

    println!(
        "{} [{}]: palette={} quality={:?} size={}",
        name,
        label,
        palette.len(),
        quality,
        png_bytes.len()
    );
}

fn main() {
    let out_dir = Path::new("compare-output");
    fs::create_dir_all(out_dir).unwrap();

    let tests: Vec<(&str, Vec<RGBA>)> = vec![
        ("solid-red", create_solid_red()),
        ("gradient", create_gradient()),
        ("four-quadrants", create_four_quadrants()),
        ("transparent", create_transparent()),
    ];

    for (name, pixels) in tests {
        quantize_and_save(name, &pixels, out_dir, 0.0);
        quantize_and_save(name, &pixels, out_dir, 1.0);
    }
}
