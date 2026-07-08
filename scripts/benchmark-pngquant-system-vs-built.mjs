#!/usr/bin/env node
/**
 * Benchmark: system pngquant CLI vs freshly built pngquant binary.
 *
 * Both are native pngquant, but versions differ:
 *   - system pngquant: 3.0.3 with imagequant 4.2.2
 *   - built pngquant:  3.0.4 with imagequant 4.5.0
 *
 * Usage:
 *   node scripts/benchmark-pngquant-system-vs-built.mjs <input.png> <built-pngquant-binary> [output-dir]
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, parse, join } from 'node:path';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const execFileAsync = promisify(execFile);

if (process.argv.length < 4) {
  console.error('Usage: node scripts/benchmark-pngquant-system-vs-built.mjs <input.png> <built-pngquant-binary> [output-dir]');
  process.exit(1);
}

const sourcePath = process.argv[2];
const BUILT_PNGQUANT = process.argv[3];
const outDir = process.argv[4] || join(process.cwd(), 'benchmark-output', 'pngquant-system-vs-built');

const SYSTEM_PNGQUANT = 'pngquant';

const MAX_COLORS_LIST = [8, 16, 32, 64, 128, 256];
const QUALITY_LIST = [10, 30, 50, 70, 90];
const SPEED_LIST = [3, 6, 9];

const sourceName = parse(basename(sourcePath)).name;

async function runPngquant(binary, input, outPath, { colors, quality, speed }) {
  const start = performance.now();
  await execFileAsync(binary, [
    '--force',
    '--output', outPath,
    '--colors', String(colors),
    '--speed', String(speed),
    '--quality', `0-${quality}`,
    '--nofs',
    input,
  ]);
  return performance.now() - start;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const total = MAX_COLORS_LIST.length * QUALITY_LIST.length * SPEED_LIST.length;
  const results = [];

  console.log('Running system pngquant...');
  let done = 0;
  for (const colors of MAX_COLORS_LIST) {
    for (const quality of QUALITY_LIST) {
      for (const speed of SPEED_LIST) {
        const outName = `${sourceName}-c${colors}-q${quality}-s${speed}-system.png`;
        const systemMs = await runPngquant(SYSTEM_PNGQUANT, sourcePath, join(outDir, outName), { colors, quality, speed });
        results.push({ colors, quality, speed, systemMs });
        done++;
        process.stdout.write(`\rsystem: ${done}/${total}`);
      }
    }
  }

  console.log('\nRunning built pngquant...');
  done = 0;
  for (const colors of MAX_COLORS_LIST) {
    for (const quality of QUALITY_LIST) {
      for (const speed of SPEED_LIST) {
        const outName = `${sourceName}-c${colors}-q${quality}-s${speed}-built.png`;
        const builtMs = await runPngquant(BUILT_PNGQUANT, sourcePath, join(outDir, outName), { colors, quality, speed });
        const row = results.find((r) => r.colors === colors && r.quality === quality && r.speed === speed);
        row.builtMs = builtMs;
        done++;
        process.stdout.write(`\rbuilt: ${done}/${total}`);
      }
    }
  }

  console.log('\nGenerating summary...');
  let csv = 'colors,quality,speed,system_size,built_size,built_larger_pct,system_ms,built_ms,built_slower_pct\n';
  for (const { colors, quality, speed, systemMs, builtMs } of results) {
    const systemPath = join(outDir, `${sourceName}-c${colors}-q${quality}-s${speed}-system.png`);
    const builtPath = join(outDir, `${sourceName}-c${colors}-q${quality}-s${speed}-built.png`);
    const systemSize = readFileSync(systemPath).length;
    const builtSize = readFileSync(builtPath).length;
    const sizePct = ((builtSize - systemSize) / systemSize * 100).toFixed(2);
    const timePct = ((builtMs - systemMs) / systemMs * 100).toFixed(2);
    csv += `${colors},${quality},${speed},${systemSize},${builtSize},${sizePct},${systemMs.toFixed(2)},${builtMs.toFixed(2)},${timePct}\n`;
  }

  await writeFile(join(outDir, 'summary.csv'), csv);
  console.log(`\nDone. Outputs saved to: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
