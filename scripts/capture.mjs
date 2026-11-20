import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const docs = path.join(root, 'docs');
const draft = 'I drafted this on the train and the tab died at the station. Cone 6, slow cool, do not rush the glaze.';
const earlier = 'Thursday kiln note: slow cool, leave the lid cracked.';

function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const server = spawn(process.execPath, [path.join(root, 'e2e/server.mjs')], {
  cwd: root,
  stdio: 'ignore',
});
await expect.poll(async () => {
  try {
    const response = await fetch('http://127.0.0.1:4173/');
    return response.ok;
  } catch {
    return false;
  }
}).toBe(true);

const userData = mkdtempSync(path.join(os.tmpdir(), 'typeback-shot-'));
const context = await chromium.launchPersistentContext(userData, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--headless=new',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-gpu',
  ],
});

try {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const comment = page.locator('#comment');
  await comment.fill(earlier);
  await comment.blur();
  await comment.fill(draft);
  await comment.blur();
  await expect.poll(async () => worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).toContain(draft);

  await page.reload();
  await comment.focus();
  await page.getByRole('button', { name: /Restore typed text/ }).click();
  await page.getByRole('button', { name: 'Latest' }).waitFor();
  const restorePath = path.join(docs, 'screenshot-restore.png');
  await page.screenshot({ path: restorePath });

  const now = Date.now();
  await worker.evaluate(async (stamp) => {
    const stored = await chrome.storage.local.get('entries');
    const entries = stored.entries && typeof stored.entries === 'object' ? stored.entries : {};
    entries['mail-1'] = {
      id: 'mail-1',
      origin: 'https://mail.example',
      urlKey: '/mail/u/0',
      href: 'https://mail.example/mail/u/0',
      fieldKey: 'tag:div|type:contenteditable|label:message body',
      label: 'Message body',
      createdAt: stamp - 3 * 60 * 60 * 1000,
      updatedAt: stamp - 2 * 60 * 60 * 1000,
      pinned: true,
      encrypted: false,
      charCount: 86,
      text: 'Hi Maya — the kiln schedule is cone 6, slow cool. Sending this before the tab closes on me.',
      versions: [],
    };
    entries['post-1'] = {
      id: 'post-1',
      origin: 'https://forum.example',
      urlKey: '/t/cracked-rim',
      href: 'https://forum.example/t/cracked-rim',
      fieldKey: 'tag:textarea|name:reply|label:reply',
      label: 'Reply',
      createdAt: stamp - 26 * 60 * 60 * 1000,
      updatedAt: stamp - 26 * 60 * 60 * 1000,
      pinned: false,
      encrypted: false,
      charCount: 78,
      text: 'The crack was in the drying, not the firing. I wrapped the rim and waited another day.',
      versions: [],
    };
    await chrome.storage.local.set({ entries });
  }, now);

  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.locator('#lede').waitFor();
  await popup.locator('#scope-all').click();
  await popup.locator('.entry').first().waitFor();
  await popup.addStyleTag({
    content: 'html{background:#f3efe6} body{margin:36px auto !important}',
  });
  const popupPath = path.join(docs, 'screenshot-popup.png');
  await popup.screenshot({ path: popupPath });

  const options = await context.newPage();
  await options.setViewportSize({ width: 1280, height: 800 });
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await options.locator('#lede').waitFor();
  await options.locator('#retention').waitFor();
  const optionsPath = path.join(docs, 'screenshot-options.png');
  await options.screenshot({ path: optionsPath });

  for (const file of [restorePath, popupPath, optionsPath]) {
    const size = pngSize(file);
    if (size.width !== 1280 || size.height !== 800) {
      throw new Error(`${file} is ${size.width}x${size.height}`);
    }
    console.log(`${path.basename(file)} ${size.width}x${size.height}`);
  }
} finally {
  await context.close();
  rmSync(userData, { recursive: true, force: true });
  server.kill();
}
