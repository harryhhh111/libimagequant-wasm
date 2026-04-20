import { describe, it, expect, beforeAll } from 'vitest';
import initWasm, {
  ImageQuantizer,
  encode_palette_to_png,
} from '../dist/wasm/libimagequant_wasm.js';
import { createTestImageData } from './helpers';

beforeAll(async () => {
  await initWasm();
});

interface BenchmarkResult {
  level: number;
  size: number;
  encodeTimeMs: number;
}

function runEncodeBenchmark(
  indices: Uint8Array,
  palette: number[][],
  width: number,
  height: number,
  level: number,
  iterations: number
): BenchmarkResult {
  const start = performance.now();
  let size = 0;
  for (let i = 0; i < iterations; i++) {
    const result = encode_palette_to_png(indices, palette, width, height, level);
    size = result.length;
  }
  const end = performance.now();
  return {
    level,
    size,
    encodeTimeMs: (end - start) / iterations,
  };
}

describe('Compression level benchmark', () => {
  it('varied pattern: level 9 is smaller than level 0', () => {
    const width = 200;
    const height = 200;
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = (i * 13 + Math.floor(i / width) * 7) % 64;
    }
    const palette: number[][] = [];
    for (let i = 0; i < 64; i++) {
      palette.push([i * 4, i * 4, i * 4, 255]);
    }

    const result0 = runEncodeBenchmark(indices, palette, width, height, 0, 10);
    const result9 = runEncodeBenchmark(indices, palette, width, height, 9, 10);

    // Level 9 should achieve better compression
    expect(result9.size).toBeLessThan(result0.size);

    // Log results for manual inspection
    console.log(
      `Varied pattern (${width}x${height}): ` +
        `level 0 = ${result0.size} bytes (${result0.encodeTimeMs.toFixed(2)}ms), ` +
        `level 9 = ${result9.size} bytes (${result9.encodeTimeMs.toFixed(2)}ms), ` +
        `ratio = ${(result0.size / result9.size).toFixed(2)}x`
    );
  });

  it('solid color: level 9 compresses much better than level 0', () => {
    const width = 100;
    const height = 100;
    const indices = new Uint8Array(width * height).fill(0);
    const palette = [[128, 128, 128, 255]];

    const result0 = runEncodeBenchmark(indices, palette, width, height, 0, 10);
    const result9 = runEncodeBenchmark(indices, palette, width, height, 9, 10);

    // Level 0 (NoCompression) keeps raw data size, level 9 compresses aggressively
    expect(result0.size).toBeGreaterThan(result9.size);
  });

  it('real image quantize: default (9) vs uncompressed (0)', () => {
    const width = 100;
    const height = 100;
    const imageData = createTestImageData(width, height, 'gradient');

    const q = new ImageQuantizer();
    q.setMaxColors(16);
    const result = q.quantizeImage(imageData.data, width, height);
    try {
      const palette = result.getPalette();
      const indices = result.getPaletteIndices(imageData.data, width, height);

      const result0 = runEncodeBenchmark(indices, palette, width, height, 0, 10);
      const result9 = runEncodeBenchmark(indices, palette, width, height, 9, 10);

      expect(result9.size).toBeLessThanOrEqual(result0.size);

      console.log(
        `Real image (${width}x${height}, ${palette.length} colors): ` +
          `level 0 = ${result0.size} bytes (${result0.encodeTimeMs.toFixed(2)}ms), ` +
          `level 9 = ${result9.size} bytes (${result9.encodeTimeMs.toFixed(2)}ms), ` +
          `ratio = ${(result0.size / result9.size).toFixed(2)}x`
      );
    } finally {
      result.free();
      q.free();
    }
  });

  it('compression ratio: level 9 beats level 0 for complex images', () => {
    const width = 100;
    const height = 100;
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = (i * 31 + Math.floor(i / width) * 17) % 128;
    }
    const palette: number[][] = [];
    for (let i = 0; i < 128; i++) {
      palette.push([i * 2, (i * 3) % 256, (i * 5) % 256, 255]);
    }

    const result0 = runEncodeBenchmark(indices, palette, width, height, 0, 10);
    const result9 = runEncodeBenchmark(indices, palette, width, height, 9, 10);

    // Level 9 (High) should beat level 0 (NoCompression)
    expect(result9.size).toBeLessThan(result0.size);

    console.log(
      `Complex image (${width}x${height}): ` +
        `L0=${result0.size}b, L9=${result9.size}b, ` +
        `ratio=${(result0.size / result9.size).toFixed(2)}x`
    );
  });
});
