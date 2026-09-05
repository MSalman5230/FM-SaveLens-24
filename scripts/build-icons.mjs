// All desktop and browser sizes come from the same checked-in artwork.
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'assets/branding/app-icon.png');
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');
mkdirSync(join(root, '.cache'), { recursive: true });
const stage = mkdtempSync(join(root, '.cache/icon-build-'));
const desktop = join(stage, 'desktop');
const browser = join(stage, 'browser');
const generate = (output, sizes = []) => execFileSync(process.execPath, [
  cli, 'icon', source, '--output', output,
  ...sizes.flatMap((size) => ['--png', String(size)]),
], { cwd: root, stdio: 'inherit' });

generate(desktop);
generate(browser, [16, 32, 128, 180, 192, 512]);
mkdirSync(join(root, 'src-tauri/icons'), { recursive: true });
mkdirSync(join(root, 'web/public/icons'), { recursive: true });
for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns']) {
  cpSync(join(desktop, file), join(root, 'src-tauri/icons', file));
}
for (const size of [16, 32, 128, 180, 192, 512]) {
  cpSync(join(browser, `${size}x${size}.png`), join(root, `web/public/icons/app-${size}.png`));
}
cpSync(join(desktop, 'icon.ico'), join(root, 'web/public/favicon.ico'));
console.log('Updated desktop icons, browser favicons, and home-screen icons.');
