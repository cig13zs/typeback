import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';

const dist = path.resolve('dist');
const draft = 'TYPEBACK_E2E_DRAFT kiln schedule for Thursday, slow cool.';
const password = 'hunter2-should-not-save';
const card = '4242424242424242';

async function launch(): Promise<{ context: BrowserContext; userData: string }> {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'typeback-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--headless=new',
      '--force-device-scale-factor=1',
      '--no-first-run',
      '--disable-gpu',
    ],
  });
  return { context, userData };
}

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing[0]) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 20_000 });
}

test('saves a comment, ignores secrets, and restores after reload', async () => {
  const { context, userData } = await launch();
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/');
    const worker = await serviceWorker(context);
    await page.locator('#comment').fill(draft);
    await page.locator('#password').fill(password);
    await page.locator('#card').fill(card);
    await page.locator('#comment').blur();

    await expect.poll(async () => worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), {
      timeout: 15_000,
    }).toContain(draft);

    const stored = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    expect(stored).not.toContain(password);
    expect(stored).not.toContain(card);

    await page.reload();
    await page.locator('#password').focus();
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: /Restore typed text/ })).toHaveCount(0);

    await page.locator('#comment').focus();
    const chip = page.getByRole('button', { name: /Restore typed text/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await page.getByRole('button', { name: /Latest/ }).click();
    await expect(page.locator('#comment')).toHaveValue(draft);
  } finally {
    await context.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('restores text inside an open shadow root and a same-origin iframe', async () => {
  const { context, userData } = await launch();
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/');
    await serviceWorker(context);
    const shadow = page.locator('#shadow-note');
    await shadow.fill('shadow draft stays');
    await shadow.blur();
    const frame = page.frameLocator('#frame');
    await frame.locator('#frame-note').fill('iframe draft stays');
    await frame.locator('#frame-note').blur();

    await expect.poll(async () => {
      const worker = context.serviceWorkers()[0];
      if (!worker) return '';
      return worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    }).toContain('iframe draft stays');

    await page.reload();
    await page.locator('#shadow-note').focus();
    await page.getByRole('button', { name: /Restore typed text/ }).click();
    await page.getByRole('button', { name: /Latest/ }).click();
    await expect(page.locator('#shadow-note')).toHaveValue('shadow draft stays');

    await frame.locator('#frame-note').focus();
    await frame.getByRole('button', { name: /Restore typed text/ }).click();
    await frame.getByRole('button', { name: /Latest/ }).click();
    await expect(frame.locator('#frame-note')).toHaveValue('iframe draft stays');
  } finally {
    await context.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
