#!/usr/bin/env node
/**
 * Compare the project's native imagequant crate (Rust) with the WASM output.
 *
 * This removes version mismatch as a variable: both sides use the exact same
 * imagequant version declared in Cargo.toml.
 *
 * Usage:
 *   node scripts/compare-native-wasm.mjs
 *
 * Requirements:
 *   - Node.js >= 20
 *   - Rust toolchain + cargo
 *   - pnpm run build (so dist/wasm exists)
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

import initWasm, {
  ImageQuantizer,
  decode_png_to_rgba,
  encode_palette_to_png,
} from '../dist/wasm/libimagequant_wasm.js';

const execFileAsync = promisify(execFile);

const COLORS = 16;
const SPEED = 3;
const WIDTH = 100;
const HEIGHT = 100;

// ------------------------------------------------------------------
// Minimal RGBA -> PNG encoder (sufficient as imagequant input).
// ------------------------------------------------------------------
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = CRC_TABLE[(c ^ buf[n]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

function writeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const chunk = Buffer.concat([type, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunk), 0);
  return Buffer.concat([len, chunk, crc]);
}

function encodeRgbaToPng(rgba, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = width * 4;
  const raw = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0;
    rgba.copy(raw, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
  }

  const compressed = deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    writeChunk(Buffer.from('IHDR'), ihdr),
    writeChunk(Buffer.from('IDAT'), compressed),
    writeChunk(Buffer.from('IEND'), iend),
  ]);
}

// ------------------------------------------------------------------
// Test image generators
// ------------------------------------------------------------------
function createSolidRed() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function createGradient() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      data[i] = Math.floor((x / WIDTH) * 255);
      data[i + 1] = Math.floor((y / HEIGHT) * 255);
      data[i + 2] = Math.floor(((x + y) / (WIDTH + HEIGHT)) * 255);
      data[i + 3] = 255;
    }
  }
  return data;
}

function createFourQuadrants() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const isRight = x >= WIDTH / 2;
      const isBottom = y >= HEIGHT / 2;
      let color;
      if (!isRight && !isBottom) color = [255, 0, 0, 255];
      else if (isRight && !isBottom) color = [0, 255, 0, 255];
      else if (!isRight && isBottom) color = [0, 0, 255, 255];
      else color = [255, 255, 255, 255];
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
  return data;
}

function createTransparent() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      data[i] = 255;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = x < WIDTH / 2 ? 255 : 0;
    }
  }
  return data;
}

// ------------------------------------------------------------------
// WASM path
// ------------------------------------------------------------------
async function quantizeWithWasm(rgba, width, height, dithering) {
  const quantizer = new ImageQuantizer();
  try {
    quantizer.setMaxColors(COLORS);
    quantizer.setSpeed(SPEED);
    quantizer.setQuality(0, 100);

    const clamped = new Uint8ClampedArray(rgba);
    const result = quantizer.quantizeImage(clamped, width, height);
    try {
      result.setDithering(dithering);

      const palette = result.getPalette();
      const quality = result.getQuantizationQuality();
      const paletteLength = result.getPaletteLength();
      const indices = result.getPaletteIndices(clamped, width, height);

      const pngBytes = encode_palette_to_png(
        indices,
        palette,
        width,
        height,
        9,
      );

      return {
        pngBytes: new Uint8Array(pngBytes),
        palette,
        paletteLength,
        quality,
      };
    } finally {
      result.free();
    }
  } finally {
    quantizer.free();
  }
}

// ------------------------------------------------------------------
// Native Rust path: generates same outputs via cargo example.
// ------------------------------------------------------------------
async function generateNativeOutputs() {
  console.log('Building native Rust example...');
  await execFileAsync('cargo', ['run', '--example', 'native_imagequant', '--release'], {
    cwd: process.cwd(),
  });
}

// ------------------------------------------------------------------
// Comparison helpers
// ------------------------------------------------------------------
function meanSquaredError(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum / a.length;
}

function psnr(mse) {
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}

function parsePngPalette(pngBytes) {
  let pos = 8;
  let plte = null;
  let trns = null;
  while (pos < pngBytes.length) {
    const len = pngBytes.readUInt32BE(pos);
    const type = pngBytes.slice(pos + 4, pos + 8).toString('ascii');
    const data = pngBytes.slice(pos + 8, pos + 8 + len);
    if (type === 'PLTE') {
      plte = [];
      for (let i = 0; i < len; i += 3) {
        plte.push([data[i], data[i + 1], data[i + 2], 255]);
      }
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      break;
    }
    pos += 12 + len;
  }
  if (plte && trns) {
    for (let i = 0; i < Math.min(plte.length, trns.length); i++) {
      plte[i][3] = trns[i];
    }
  }
  return plte || [];
}

function paletteDifference(paletteA, paletteB) {
  const a = new Set(paletteA.map((c) => c.join(',')));
  const b = new Set(paletteB.map((c) => c.join(',')));
  const onlyInA = [...a].filter((x) => !b.has(x)).length;
  const onlyInB = [...b].filter((x) => !a.has(x)).length;
  return {
    onlyInA,
    onlyInB,
    common: Math.min(paletteA.length, paletteB.length) - Math.max(onlyInA, onlyInB),
  };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  const workDir = join(tmpdir(), `liq-compare-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  // Load WASM once
  const wasmBytes = readFileSync(
    new URL('../dist/wasm/libimagequant_wasm_bg.wasm', import.meta.url),
  );
  await initWasm({ module_or_path: wasmBytes });

  // Generate native Rust outputs first
  await generateNativeOutputs();

  const tests = [
    { name: 'solid-red', data: createSolidRed() },
    { name: 'gradient', data: createGradient() },
    { name: 'four-quadrants', data: createFourQuadrants() },
    { name: 'transparent', data: createTransparent() },
  ];

  const outDir = join(process.cwd(), 'compare-output');
  await mkdir(outDir, { recursive: true });

  console.log(`\nComparing native Rust imagequant vs WASM imagequant`);
  console.log(`Both use the imagequant version from Cargo.lock`);
  console.log(`colors=${COLORS}, speed=${SPEED}, image=${WIDTH}x${HEIGHT}\n`);

  for (const test of tests) {
    console.log(`--- ${test.name} ---`);

    for (const { label, dithering } of [
      { label: 'nofs', dithering: 0.0 },
      { label: 'dither', dithering: 1.0 },
    ]) {
      console.log(`  [${label}]`);

      // WASM output
      const wasmResult = await quantizeWithWasm(test.data, WIDTH, HEIGHT, dithering);
      await writeFile(
        join(outDir, `${test.name}-${label}-wasm.png`),
        Buffer.from(wasmResult.pngBytes),
      );

      // Native Rust output (already generated by cargo example)
      const nativePath = join(outDir, `${test.name}-${label}-native-rust.png`);
      const nativePng = readFileSync(nativePath);

      // Decode both back to RGBA using WASM decoder
      const nativeRgba = decode_png_to_rgba(new Uint8Array(nativePng));
      const wasmRgba = decode_png_to_rgba(wasmResult.pngBytes);

      const nativeDecoded = Buffer.from(nativeRgba[0]);
      const wasmDecoded = Buffer.from(wasmRgba[0]);

      const mse = meanSquaredError(nativeDecoded, wasmDecoded);
      const nativePalette = parsePngPalette(nativePng);
      const paletteDiff = paletteDifference(nativePalette, wasmResult.palette);

      console.log(`    native size:  ${nativePng.length} bytes`);
      console.log(`    wasm size:    ${wasmResult.pngBytes.length} bytes`);
      console.log(`    native palette: ${nativePalette.length} colors`);
      console.log(`    wasm palette:   ${wasmResult.paletteLength} colors`);
      console.log(`    wasm quality:   ${(wasmResult.quality * 100).toFixed(1)}%`);
      console.log(`    palette diff:   only-in-native=${paletteDiff.onlyInA}, only-in-wasm=${paletteDiff.onlyInB}, common=${paletteDiff.common}`);
      console.log(`    pixel MSE vs native: ${mse.toFixed(2)}`);
      console.log(`    PSNR: ${Number.isFinite(psnr(mse)) ? psnr(mse).toFixed(2) + ' dB' : 'Infinite'}`);
    }
  }

  // Cleanup temp dir
  await rm(workDir, { recursive: true, force: true });

  console.log(`\nOutputs saved to: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
