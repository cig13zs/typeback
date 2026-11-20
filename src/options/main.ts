import '../styles/theme.css';
import './options.css';
import { DEFAULT_BLOCKLIST } from '../lib/blocklist';
import copy from '../copy.json';
import { formatBytes, formatCount } from '../lib/format';
import type { BackupFile, Settings } from '../lib/types';
import { rpc } from '../ui/rpc';

interface SettingsPayload {
  settings: Settings;
  encryptionEnabled: boolean;
  unlocked: boolean;
}

const status = document.querySelector('#status') as HTMLParagraphElement;
const paused = document.querySelector('#paused') as HTMLInputElement;
const retention = document.querySelector('#retention') as HTMLInputElement;
const blocklist = document.querySelector('#blocklist') as HTMLTextAreaElement;
const encOff = document.querySelector('#enc-off') as HTMLDivElement;
const encLocked = document.querySelector('#enc-locked') as HTMLDivElement;
const encOn = document.querySelector('#enc-on') as HTMLDivElement;

const lede = document.querySelector('#lede');
if (lede) lede.textContent = copy.shortDescription;
const about = document.querySelector('#about');
if (about) {
  const version = chrome.runtime.getManifest().version;
  about.textContent = `${copy.storeName} · v${version}. Text stays on this device. Passwords, card fields, and one-time codes are never saved.`;
}

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function showEncryption(payload: SettingsPayload): void {
  encOff.hidden = payload.encryptionEnabled;
  encLocked.hidden = !(payload.encryptionEnabled && !payload.unlocked);
  encOn.hidden = !(payload.encryptionEnabled && payload.unlocked);
}

async function load(): Promise<void> {
  const response = await rpc<SettingsPayload>({ type: 'getSettings' });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  paused.checked = response.data.settings.paused;
  retention.value = String(response.data.settings.retentionDays);
  blocklist.value = response.data.settings.blocklist.join('\n');
  showEncryption(response.data);
  await loadUsage();
}

async function loadUsage(): Promise<void> {
  const response = await rpc<{ bytes: number; quota: number; count: number; pinned: number }>({
    type: 'usage',
  });
  const label = document.querySelector('#usage-label');
  const bar = document.querySelector('#usage-bar');
  if (!response.ok || !(label instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
  const { bytes, quota, count, pinned: pinnedCount } = response.data;
  label.textContent = `${formatBytes(bytes)} of ${formatBytes(quota)} · ${formatCount(count)} drafts · ${formatCount(pinnedCount)} pinned`;
  const ratio = quota > 0 ? Math.min(100, (bytes / quota) * 100) : 0;
  bar.style.width = `${ratio}%`;
}

paused.addEventListener('change', async () => {
  const response = await rpc<Settings>({ type: 'updateSettings', settings: { paused: paused.checked } });
  if (!response.ok) setStatus(response.error, true);
  else setStatus(paused.checked ? 'Paused.' : 'Saving again.');
});

retention.addEventListener('change', async () => {
  const days = Number(retention.value);
  const response = await rpc({ type: 'updateSettings', settings: { retentionDays: days } });
  if (!response.ok) setStatus(response.error, true);
  else setStatus(days === 0 ? 'Drafts are kept until you delete them.' : `Drafts are kept for ${days} days.`);
});

document.querySelector('#save-blocklist')?.addEventListener('click', async () => {
  const response = await rpc({
    type: 'updateSettings',
    settings: { blocklist: blocklist.value.split(/\r?\n/) },
  });
  if (!response.ok) setStatus(response.error, true);
  else {
    setStatus('Blocklist saved.');
    await load();
  }
});

document.querySelector('#reset-blocklist')?.addEventListener('click', async () => {
  blocklist.value = DEFAULT_BLOCKLIST.join('\n');
  const response = await rpc({
    type: 'updateSettings',
    settings: { blocklist: [...DEFAULT_BLOCKLIST] },
  });
  if (!response.ok) setStatus(response.error, true);
  else setStatus('Restored the default blocklist.');
});

document.querySelector('#enable')?.addEventListener('click', async () => {
  const first = (document.querySelector('#pass1') as HTMLInputElement).value;
  const second = (document.querySelector('#pass2') as HTMLInputElement).value;
  if (first !== second) {
    setStatus('The passphrases do not match.', true);
    return;
  }
  const button = document.querySelector('#enable');
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.textContent = 'Encrypting…';
  }
  const response = await rpc({ type: 'enableEncryption', passphrase: first });
  if (button instanceof HTMLButtonElement) {
    button.disabled = false;
    button.textContent = 'Encrypt saved text';
  }
  if (!response.ok) setStatus(response.error, true);
  else {
    (document.querySelector('#pass1') as HTMLInputElement).value = '';
    (document.querySelector('#pass2') as HTMLInputElement).value = '';
    setStatus('Drafts are encrypted on this device.');
    await load();
  }
});

document.querySelector('#unlock')?.addEventListener('click', async () => {
  const passphrase = (document.querySelector('#unlock-pass') as HTMLInputElement).value;
  const response = await rpc({ type: 'unlock', passphrase });
  if (!response.ok) setStatus(response.error, true);
  else {
    setStatus('Unlocked for this browser session.');
    await load();
  }
});

document.querySelector('#lock')?.addEventListener('click', async () => {
  const response = await rpc({ type: 'lock' });
  if (!response.ok) setStatus(response.error, true);
  else {
    setStatus('Locked. Unlock again to save and read drafts.');
    await load();
  }
});

document.querySelector('#disable')?.addEventListener('click', async () => {
  if (!window.confirm('Turn encryption off? Drafts will be stored as plain text on this device.')) return;
  const passphrase = (document.querySelector('#disable-pass') as HTMLInputElement).value;
  const response = await rpc({ type: 'disableEncryption', passphrase });
  if (!response.ok) setStatus(response.error, true);
  else {
    setStatus('Encryption is off.');
    await load();
  }
});

document.querySelector('#change')?.addEventListener('click', async () => {
  const current = (document.querySelector('#disable-pass') as HTMLInputElement).value;
  const next = (document.querySelector('#next-pass') as HTMLInputElement).value;
  const response = await rpc({ type: 'changePassphrase', current, next });
  if (!response.ok) setStatus(response.error, true);
  else {
    (document.querySelector('#disable-pass') as HTMLInputElement).value = '';
    (document.querySelector('#next-pass') as HTMLInputElement).value = '';
    setStatus('Passphrase changed. Drafts were re-encrypted.');
  }
});

document.querySelector('#export')?.addEventListener('click', async () => {
  const response = await rpc<BackupFile>({ type: 'exportBackup' });
  if (!response.ok) {
    setStatus(response.error, true);
    return;
  }
  const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `typeback-backup-${day}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Backup downloaded. It does not include your passphrase.');
});

const fileInput = document.querySelector('#import-file') as HTMLInputElement;
document.querySelector('#import')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  if (!window.confirm('Replace drafts on this device with this backup?')) return;
  try {
    const backup = JSON.parse(await file.text()) as BackupFile;
    const response = await rpc<{ count: number }>({ type: 'importBackup', backup });
    if (!response.ok) setStatus(response.error, true);
    else {
      setStatus(`Imported ${response.data.count} drafts.`);
      await load();
    }
  } catch {
    setStatus('That file is not valid JSON.', true);
  }
});

document.querySelector('#clear')?.addEventListener('click', async () => {
  if (!window.confirm('Delete every draft that is not pinned?')) return;
  const response = await rpc<{ removed: number }>({ type: 'clearUnpinned' });
  if (!response.ok) setStatus(response.error, true);
  else {
    setStatus(`Deleted ${response.data.removed} drafts.`);
    await loadUsage();
  }
});

void chrome.commands.getAll().then((commands) => {
  const command = commands.find((item) => item.name === 'restore-typed-text');
  const el = document.querySelector('#shortcut');
  if (el) el.textContent = command?.shortcut || 'Ctrl+Shift+Y (set a shortcut in chrome://extensions/shortcuts)';
});

void load();
