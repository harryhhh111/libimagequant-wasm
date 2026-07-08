const { readdir, writeFile, stat } = require('fs/promises');
const { join } = require('path');

const dir = join(process.cwd(), 'benchmark-output', 'Anubis');

async function main() {
  const files = await readdir(dir);
  const rows = [];
  for (const file of files) {
    if (file === 'summary.csv' || file.endsWith('-original.png')) continue;
    const m = file.match(/-c(\d+)-q(\d+)-s(\d+)-(native|wasm)\.png$/);
    if (!m) continue;
    const [, colors, quality, speed, kind] = m;
    const { size } = await stat(join(dir, file));
    rows.push({ file, colors, quality, speed, kind, size });
  }

  // Group by params
  const groups = {};
  for (const row of rows) {
    const key = `c${row.colors}-q${row.quality}-s${row.speed}`;
    if (!groups[key]) groups[key] = {};
    groups[key][row.kind] = row.size;
  }

  let csv = 'colors,quality,speed,native_size,wasm_size,wasm_larger_pct\n';
  const keys = Object.keys(groups).sort();
  for (const key of keys) {
    const g = groups[key];
    const pct = (((g.wasm - g.native) / g.native) * 100).toFixed(2);
    const [, c, q, s] = key.match(/c(\d+)-q(\d+)-s(\d+)/);
    csv += `${c},${q},${s},${g.native},${g.wasm},${pct}\n`;
  }

  await writeFile(join(dir, 'summary.csv'), csv);
  console.log('summary.csv written');
}

main().catch(console.error);
