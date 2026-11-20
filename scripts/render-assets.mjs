import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = '/usr/bin/google-chrome';
const iconDir = path.join(root, 'public/icons');
const docs = path.join(root, 'docs');
mkdirSync(iconDir, { recursive: true });
mkdirSync(docs, { recursive: true });

function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function shoot(htmlPath, outPath, width, height) {
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${width},${height}`,
    `--screenshot=${outPath}`,
    `file://${htmlPath}`,
  ], { stdio: 'inherit' });
  const size = pngSize(outPath);
  if (size.width !== width || size.height !== height) {
    throw new Error(`${outPath} is ${size.width}x${size.height}, expected ${width}x${height}`);
  }
}

const iconHtml = path.join(root, 'assets/icon.html');
const svg = readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
writeFileSync(iconHtml, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#1f4d45}svg{display:block;width:100%;height:100%}</style>${svg}`);

for (const size of [16, 32, 48, 128]) {
  shoot(iconHtml, path.join(iconDir, `icon-${size}.png`), size, size);
}

shoot(path.join(root, 'assets/promo.html'), path.join(docs, 'promo-440x280.png'), 440, 280);
console.log('Rendered icons and promo tile');
