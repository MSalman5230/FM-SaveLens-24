// Local validation only: no source saves or extracted databases are published.
import { spawnSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const folder = process.argv[2] || process.env.FMSCOUT_FIXTURE_DIR;
if (!folder) throw new Error('Pass the save directory: npm run test:parity -- PATH');
const binary = resolve('target/release/examples/parse-save' + (process.platform === 'win32' ? '.exe' : ''));
if (!existsSync(binary)) throw new Error('Build the Rust reference tool: cargo build --release --locked --example parse-save');
async function hash(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
function rust(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [path], { windowsHide: true }); const chunks = []; let errors = '';
    child.stdout.on('data', b => chunks.push(b)); child.stderr.on('data', b => errors += b);
    child.on('error', reject); child.on('close', code => { if (code) return reject(new Error(errors || `Rust exited ${code}`)); try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (e) { reject(e); } });
  });
}
const report = [];
for (const name of readdirSync(folder).filter(n => n.toLowerCase().endsWith('.fm')).sort()) {
  const path = join(folder, name); const before = await hash(path); const started = performance.now();
  // Separate processes release all large buffers between saves.
  const reference = spawnSync(process.execPath, ['scripts/reference-parse.mjs', path], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (reference.status !== 0) throw new Error(reference.stderr);
  const expected = JSON.parse(reference.stdout), actual = await rust(path);
  if (expected.error) { assert.equal(actual.code, expected.code, name); }
  else {
    assert.equal(actual.error, undefined, `${name}: ${actual.error}`);
    for (const key of ['name', 'formatVersion', 'gameDate', 'players', 'clubs', 'warnings']) assert.deepEqual(actual[key], expected[key], `${name}: ${key}`);
    for (const [key, value] of Object.entries(expected.diagnostics)) if (!['elapsedMs','rssBytes'].includes(key)) assert.deepEqual(actual.diagnostics[key], value, `${name}: ${key}`);
  }
  assert.equal(await hash(path), before, `${name}: source changed`);
  const result = { file: name, players: actual.players?.length, expectedError: actual.code, unchanged: true, elapsedMs: Math.round(performance.now() - started) };
  report.push(result); mkdirSync('.cache', { recursive: true }); writeFileSync('.cache/rust-parity.json', JSON.stringify(report, null, 2));
  console.log(`${report.length}: ${name}: ${result.players ?? result.expectedError}; identical and unchanged`);
}
console.log(`Verified ${report.length} saves against the TypeScript reference.`);
