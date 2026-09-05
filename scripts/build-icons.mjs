// All desktop and browser sizes come from the same checked-in artwork.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'assets/branding/app-icon.png');
const require = createRequire(import.meta.url);
let stage;
let step = 'checking source artwork';

try {
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Restore the source artwork at ${source} before rebuilding icons.`);
  }

  step = 'resolving Tauri CLI';
  const manifestPath = require.resolve('@tauri-apps/cli/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.bin?.tauri !== 'string' || !manifest.bin.tauri) {
    throw new Error(`No tauri executable is declared in ${manifestPath}.`);
  }
  const cli = resolve(dirname(manifestPath), manifest.bin.tauri);
  if (!statSync(cli, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`The Tauri CLI executable is missing at ${cli}.`);
  }

  step = 'creating the icon staging directory';
  mkdirSync(join(root, '.cache'), { recursive: true });
  stage = mkdtempSync(join(root, '.cache/icon-build-'));
  const desktop = join(stage, 'desktop');
  const browser = join(stage, 'browser');
  const generate = (output, sizes = []) => execFileSync(process.execPath, [
    cli, 'icon', source, '--output', output,
    ...sizes.flatMap((size) => ['--png', String(size)]),
  ], { cwd: root, stdio: 'inherit' });

  step = 'generating desktop icons';
  generate(desktop);
  // --png replaces the default outputs, so desktop formats need their own call.
  step = 'generating browser icons';
  generate(browser, [16, 32, 128, 180, 192, 512]);
  step = 'copying generated icons';
  mkdirSync(join(root, 'src-tauri/icons'), { recursive: true });
  mkdirSync(join(root, 'web/public/icons'), { recursive: true });
  for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns']) {
    cpSync(join(desktop, file), join(root, 'src-tauri/icons', file));
  }
  for (const size of [16, 32, 128, 180, 192, 512]) {
    cpSync(join(browser, `${size}x${size}.png`), join(root, `web/public/icons/app-${size}.png`));
  }
  cpSync(join(desktop, 'icon.ico'), join(root, 'web/public/favicon.ico'));
} catch (error) {
  console.error(`Icon build failed while ${step}: ${error.message}`);
  if (step === 'resolving Tauri CLI') {
    console.error(`Run npm ci in ${root} to restore the pinned Tauri CLI.`);
  } else if (step.startsWith('generating')) {
    console.error(`Check the Tauri output above and verify that ${source} is a valid square PNG.`);
  }
  process.exitCode = 1;
} finally {
  if (stage) {
    try {
      rmSync(stage, { recursive: true, force: true });
    } catch (error) {
      console.error(`Could not remove icon staging directory ${stage}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
if (!process.exitCode) {
  console.log('Updated desktop icons, browser favicons, and home-screen icons.');
}
