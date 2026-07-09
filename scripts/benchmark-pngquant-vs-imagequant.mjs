#!/usr/bin/env node
/**
 * Benchmark: system pngquant CLI vs project's native imagequant crate.
 *
 * This excludes WASM entirely. Both sides are native code, only the
 * underlying libimagequant version differs:
 *   - pngquant CLI: imagequant 4.2.2
 *   - Rust example: imagequant 4.4.1 (from Cargo.lock)
 *
 * Usage:
 *   node scripts/benchmark-pngquant-vs-imagequant.mjs <input.png> [output-dir]
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, parse, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

if (process.argv.length < 3) {
  console.error('Usage: node scripts/benchmark-pngquant-vs-imagequant.mjs <input.png> [output-dir]');
  process.exit(1);
}

const sourcePath = process.argv[2];
const outDir = process.argv[3] || join(process.cwd(), 'benchmark-output', 'native-vs-native');

const MAX_COLORS_LIST = [8, 16, 32, 64, 128, 256];
const QUALITY_LIST = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const SPEED_LIST = [3, 6, 9];

const sourceName = parse(basename(sourcePath)).name;

async function runPngquant(input, outPath, { colors, quality, speed }) {
  await execFileAsync('pngquant', [
    '--force',
    '--output', outPath,
    '--colors', String(colors),
    '--speed', String(speed),
    '--quality', `0-${quality}`,
    '--nofs',
    input,
  ]);
}

async function runRustExample(input, outDir) {
  await execFileAsync('cargo', [
    'run',
    '--example', 'benchmark_imagequant',
    '--release',
    '--',
    input,
    outDir,
  ], { cwd: process.cwd() });
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Build Rust example once first
  console.log('Building Rust example...');
  await execFileAsync('cargo', ['build', '--example', 'benchmark_imagequant', '--release'], {
    cwd: process.cwd(),
  });

  console.log('Running pngquant CLI...');
  let done = 0;
  const total = MAX_COLORS_LIST.length * QUALITY_LIST.length * SPEED_LIST.length;
  for (const colors of MAX_COLORS_LIST) {
    for (const quality of QUALITY_LIST) {
      for (const speed of SPEED_LIST) {
        const outName = `${sourceName}-c${colors}-q${quality}-s${speed}-pngquant.png`;
        await runPngquant(sourcePath, join(outDir, outName), { colors, quality, speed });
        done++;
        process.stdout.write(`\rpngquant: ${done}/${total}`);
      }
    }
  }

  console.log('\nRunning native imagequant example...');
  await runRustExample(sourcePath, outDir);

  console.log('\nGenerating summary...');
  let csv = 'colors,quality,speed,pngquant_size,imagequant_size,imagequant_larger_pct\n';
  for (const colors of MAX_COLORS_LIST) {
    for (const quality of QUALITY_LIST) {
      for (const speed of SPEED_LIST) {
        const pngquantPath = join(outDir, `${sourceName}-c${colors}-q${quality}-s${speed}-pngquant.png`);
        const imagequantPath = join(outDir, `${sourceName}-c${colors}-q${quality}-s${speed}-imagequant.png`);
        const pngquantSize = readFileSync(pngquantPath).length;
        const imagequantSize = readFileSync(imagequantPath).length;
        const pct = ((imagequantSize - pngquantSize) / pngquantSize * 100).toFixed(2);
        csv += `${colors},${quality},${speed},${pngquantSize},${imagequantSize},${pct}\n`;
      }
    }
  }

  await writeFile(join(outDir, 'summary.csv'), csv);
  console.log(`\nDone. Outputs saved to: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
