#!/usr/bin/env node
/**
 * Isolate the effect of zlib memLevel on indexed PNG file size.
 *
 * Uses the WASM module to quantize (so palette/indices are fixed),
 * then re-encodes the same palette+indices with different memLevels.
 */

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import initWasm, {
  ImageQuantizer,
  decode_png_to_rgba,
} from '../dist/wasm/libimagequant_wasm.js';

if (process.argv.length < 3) {
  console.error('Usage: node scripts/test-memlevel.mjs <input.png>');
  process.exit(1);
}

const SOURCE_PATH = process.argv[2];

// ------------------------------------------------------------------
// Minimal PNG chunk writer
// ------------------------------------------------------------------
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

function writeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const chunk = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunk), 0);
  return Buffer.concat([len, chunk, crc]);
}

function packIndices(indices, width, height, bitDepth) {
  const indicesPerByte = 8 / bitDepth;
  const bytesPerRow = (width * bitDepth + 7) / 8;
  const packed = Buffer.alloc(height * (bytesPerRow + 1));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (bytesPerRow + 1);
    packed[rowOffset] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const index = indices[y * width + x];
      const byteIndex = rowOffset + 1 + Math.floor(x / indicesPerByte);
      const bitShift = 8 - bitDepth - (x % indicesPerByte) * bitDepth;
      packed[byteIndex] |= index << bitShift;
    }
  }

  return packed;
}

function encodePng({ width, height, bitDepth, palette, indices, memLevel, level = 9 }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 3; // Indexed color
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // PLTE
  const plte = Buffer.alloc(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plte[i * 3] = palette[i][0];
    plte[i * 3 + 1] = palette[i][1];
    plte[i * 3 + 2] = palette[i][2];
  }

  // tRNS
  let trns = null;
  const lastNonOpaque = palette.map((c) => c[3]).findLastIndex((a) => a < 255);
  if (lastNonOpaque >= 0) {
    trns = Buffer.alloc(lastNonOpaque + 1);
    for (let i = 0; i <= lastNonOpaque; i++) {
      trns[i] = palette[i][3];
    }
  }

  // IDAT
  const packed = packIndices(indices, width, height, bitDepth);
  const compressed = deflateSync(packed, { level, memLevel });

  // IEND
  const chunks = [
    signature,
    writeChunk('IHDR', ihdr),
    writeChunk('PLTE', plte),
  ];
  if (trns) chunks.push(writeChunk('tRNS', trns));
  chunks.push(writeChunk('IDAT', compressed));
  chunks.push(writeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  const wasmBytes = readFileSync(
    new URL('../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url),
  );
  await initWasm({ module_or_path: wasmBytes });

  const sourcePng = readFileSync(SOURCE_PATH);
  const [rgba, width, height] = decode_png_to_rgba(new Uint8Array(sourcePng));

  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Dimensions: ${width}x${height}`);
  console.log(`Original size: ${sourcePng.length} bytes\n`);

  for (const maxColors of [8, 16, 32, 64, 128, 256]) {
    const quantizer = new ImageQuantizer();
    quantizer.setMaxColors(maxColors);
    quantizer.setSpeed(3);
    quantizer.setQuality(0, 100);

    const result = quantizer.quantizeImage(rgba, width, height);
    const palette = result.getPalette();
    const indices = result.getPaletteIndices(rgba, width, height);

    const bitDepth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;

    console.log(`--- maxColors=${maxColors}, actual palette=${palette.length}, bitDepth=${bitDepth} ---`);

    for (const memLevel of [5, 6, 7, 8, 9]) {
      const png = encodePng({ width, height, bitDepth, palette, indices, memLevel, level: 9 });
      console.log(`  memLevel=${memLevel}: ${png.length} bytes`);
    }

    const diff = (a, b) => ((b - a) / a * 100).toFixed(2);
    const size5 = encodePng({ width, height, bitDepth, palette, indices, memLevel: 5, level: 9 }).length;
    const size8 = encodePng({ width, height, bitDepth, palette, indices, memLevel: 8, level: 9 }).length;
    console.log(`  memLevel=5 vs 8: ${size5 < size8 ? 'smaller' : 'larger'} by ${diff(Math.min(size5, size8), Math.max(size5, size8))}%\n`);

    result.free();
    quantizer.free();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
