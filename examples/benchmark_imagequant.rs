use imagequant::{Attributes, Image, RGBA};
use png::{BitDepth, ColorType, Compression, Decoder, Encoder, Filter, Transformations};
use std::env;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

fn decode_png_to_rgba(png_bytes: &[u8]) -> (Vec<RGBA>, u32, u32) {
    let cursor = Cursor::new(png_bytes);
    let mut decoder = Decoder::new(cursor);
    decoder.set_transformations(Transformations::EXPAND);
    let mut reader = decoder.read_info().expect("Failed to read PNG info");

    let mut buf = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut buf).expect("Failed to read PNG frame");
    let buf = &buf[..info.buffer_size()];

    let rgba_buf = match info.color_type {
        ColorType::Rgba => buf.to_vec(),
        ColorType::Rgb => {
            let mut out = Vec::with_capacity(buf.len() / 3 * 4);
            for chunk in buf.chunks_exact(3) {
                out.extend_from_slice(chunk);
                out.push(255);
            }
            out
        }
        ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity(buf.len() * 2);
            for chunk in buf.chunks_exact(2) {
                let gray = chunk[0];
                out.extend_from_slice(&[gray, gray, gray, chunk[1]]);
            }
            out
        }
        ColorType::Grayscale => {
            let mut out = Vec::with_capacity(buf.len() * 4);
            for &gray in buf {
                out.extend_from_slice(&[gray, gray, gray, 255]);
            }
            out
        }
        _ => panic!("Unsupported PNG color type"),
    };

    let pixels: Vec<RGBA> = rgba_buf
        .chunks_exact(4)
        .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
        .collect();

    (pixels, info.width, info.height)
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
) -> Vec<u8> {
    let mut png_data = Vec::new();
    {
        let mut encoder = Encoder::new(Cursor::new(&mut png_data), width, height);
        encoder.set_color(ColorType::Indexed);

        let bit_depth = optimal_bit_depth(palette.len());
        encoder.set_depth(bit_depth);
        encoder.set_filter(Filter::NoFilter);
        encoder.set_compression(Compression::High);

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

fn quantize(
    pixels: &[RGBA],
    width: u32,
    height: u32,
    colors: usize,
    quality: u8,
    speed: i32,
) -> Vec<u8> {
    let mut attr = Attributes::new();
    attr.set_speed(speed).unwrap();
    attr.set_quality(0, quality).unwrap();
    attr.set_max_colors(colors as u32).unwrap();

    let mut img = Image::new(
        &mut attr,
        pixels.to_vec().into_boxed_slice(),
        width as usize,
        height as usize,
        0.0,
    )
    .expect("Failed to create image");

    let mut result = attr.quantize(&mut img).expect("Failed to quantize");
    result.set_dithering_level(0.0).unwrap();

    let palette: Vec<_> = result
        .palette()
        .iter()
        .map(|c| [c.r, c.g, c.b, c.a])
        .collect();

    let (_, indices) = result.remapped(&mut img).unwrap();
    encode_palette_png(&indices, &palette, width, height)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: cargo run --example benchmark_imagequant <input.png> <output-dir>");
        std::process::exit(1);
    }

    let input_path = PathBuf::from(&args[1]);
    let out_dir = PathBuf::from(&args[2]);

    fs::create_dir_all(&out_dir).expect("Failed to create output dir");

    let png_bytes = fs::read(&input_path).expect("Failed to read input PNG");
    let (pixels, width, height) = decode_png_to_rgba(&png_bytes);

    let source_name = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();

    let colors_list = [8usize, 16, 32, 64, 128, 256];
    let quality_list: Vec<u8> = (1..=10).map(|i| (i * 10) as u8).collect();
    let speed_list = [3i32, 6, 9];

    for colors in colors_list {
        for &quality in &quality_list {
            for &speed in &speed_list {
                let png = quantize(&pixels, width, height, colors, quality, speed,
                );
                let out_name = format!(
                    "{}-c{}-q{}-s{}-imagequant.png",
                    source_name, colors, quality, speed
                );
                fs::write(out_dir.join(&out_name), &png).unwrap();
            }
        }
    }
}
