import '../styles/theme.css';
import './popup.css';
import copy from '../copy.json';
import { previewText, timeAgo } from '../lib/format';
import type { EntryView, ExtensionStatus } from '../lib/types';
import { pageKey } from '../lib/url';
import { rpc } from '../ui/rpc';

type Scope = 'page' | 'all';

const lede = document.querySelector('#lede');
if (lede) lede.textContent = copy.shortDescription;

const list = document.querySelector('#list') as HTMLDivElement;
const status = document.querySelector('#status') as HTMLParagraphElement;
const q = document.querySelector('#q') as HTMLInputElement;
const pauseBanner = document.querySelector('#pause-banner') as HTMLDivElement;
const unlockBanner = document.querySelector('#unlock-banner') as HTMLFormElement;
const unlockPass = document.querySelector('#unlock-pass') as HTMLInputElement;
const scopePage = document.querySelector('#scope-page') as HTMLButtonElement;
const scopeAll = document.querySelector('#scope-all') as HTMLButtonElement;
const shortcut = document.querySelector('#shortcut') as HTMLSpanElement;
const count = document.querySelector('#count') as HTMLSpanElement;

let scope: Scope = 'page';
let tabId: number | null = null;
let pageHref = '';
let entries: EntryView[] = [];
let armedId = '';

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function entryUrl(entry: EntryView): string {
  try {
    const url = new URL(entry.href);
    return `${url.host}${url.pathname}`;
  } catch {
    return entry.href;
  }
}

function render(extension: ExtensionStatus | null): void {
  pauseBanner.hidden = !extension?.paused;
  unlockBanner.hidden = !(extension?.encryptionEnabled && !extension.unlocked);
  count.textContent = entries.length === 1 ? '1 draft' : `${entries.length} drafts`;
  list.replaceChildren();
  if (!pageHref && scope === 'page') {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = 'Open a web page to see drafts for it, or switch to All pages.';
    list.append(note);
    return;
  }
  if (entries.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = scope === 'page'
      ? 'Nothing saved for this page yet. Type into a form — if a crash or a closed tab takes it, Typeback can bring it back.'
      : 'No drafts yet. Type into a form and Typeback will keep it on this device.';
    list.append(note);
    return;
  }
  for (const entry of entries) {
    const card = document.createElement('article');
    card.className = 'entry';
    const header = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent = entry.pinned ? `${entry.label} · pinned` : entry.label;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = timeAgo(entry.updatedAt);
    header.append(title, when);
    const preview = document.createElement('p');
    preview.className = 'preview';
    preview.textContent = entry.text == null
      ? `Encrypted · ${entry.charCount.toLocaleString()} characters`
      : previewText(entry.text, 160);
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = entryUrl(entry);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const restore = button('Restore', 'restore', entry.id, true);
    const copyBtn = button('Copy', 'copy', entry.id, false);
    const pin = button(entry.pinned ? 'Unpin' : 'Pin', 'pin', entry.id, false);
    const del = button(armedId === entry.id ? 'Delete?' : 'Delete', 'delete', entry.id, false);
    if (armedId === entry.id) del.classList.add('armed');
    if (entry.text == null) {
      restore.disabled = true;
      copyBtn.disabled = true;
      restore.title = 'Unlock to restore';
    }
    actions.append(restore, copyBtn, pin, del);
    card.append(header, preview, url, actions);
    list.append(card);
  }
}

function button(label: string, action: string, id: string, primary: boolean): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.dataset.action = action;
  el.dataset.id = id;
  if (primary) el.classList.add('primary');
  return el;
}

async function activePage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  pageHref = '';
  if (tab?.id == null) return;
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: 'where' })) as { ok?: boolean; href?: string };
    if (response?.ok && typeof response.href === 'string') pageHref = response.href;
  } catch {
    /* not a page Typeback can see */
  }
  if (!pageHref && tab.url && /^https?:/i.test(tab.url)) pageHref = tab.url;
}

async function refresh(): Promise<void> {
  await activePage();
  const page = pageHref ? pageKey(pageHref) : null;
  const [listed, state] = await Promise.all([
    rpc<{ entries: EntryView[] }>({
      type: 'list',
      origin: scope === 'page' ? page?.origin : undefined,
      urlKey: scope === 'page' ? page?.urlKey : undefined,
      search: q.value,
    }),
    rpc<ExtensionStatus>({ type: 'getState', href: pageHref || 'http://localhost/' }),
  ]);
  if (!listed.ok) {
    setStatus(listed.error, true);
    return;
  }
  entries = listed.data.entries;
  render(state.ok ? state.data : null);
  if (state.ok && state.data.blocked && scope === 'page') {
    setStatus('Typeback is off on this site. You can still read drafts saved earlier.');
  }
}

function setScope(next: Scope): void {
  scope = next;
  scopePage.setAttribute('aria-pressed', next === 'page' ? 'true' : 'false');
  scopeAll.setAttribute('aria-pressed', next === 'all' ? 'true' : 'false');
  void refresh();
}

scopePage.addEventListener('click', () => setScope('page'));
scopeAll.addEventListener('click', () => setScope('all'));
document.querySelector('#options')?.addEventListener('click', () => void chrome.runtime.openOptionsPage());
document.querySelector('#resume')?.addEventListener('click', async () => {
  const result = await rpc({ type: 'updateSettings', settings: { paused: false } });
  if (!result.ok) setStatus(result.error, true);
  else void refresh();
});

unlockBanner.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await rpc({ type: 'unlock', passphrase: unlockPass.value });
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  unlockPass.value = '';
  setStatus('Unlocked for this browser session.');
  await refresh();
});

let searchTimer = 0;
q.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void refresh(), 120);
});

list.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const buttonEl = target.closest('button');
  if (!(buttonEl instanceof HTMLButtonElement)) return;
  const id = buttonEl.dataset.id;
  const action = buttonEl.dataset.action;
  if (!id || !action) return;
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  void act(action, entry, buttonEl);
});

async function act(action: string, entry: EntryView, buttonEl: HTMLButtonElement): Promise<void> {
  if (action === 'delete') {
    if (armedId !== entry.id) {
      armedId = entry.id;
      buttonEl.textContent = 'Delete?';
      buttonEl.classList.add('armed');
      return;
    }
    armedId = '';
    const result = await rpc({ type: 'remove', id: entry.id });
    if (!result.ok) setStatus(result.error, true);
    else await refresh();
    return;
  }
  armedId = '';
  if (action === 'pin') {
    const result = await rpc({ type: 'pin', id: entry.id, pinned: !entry.pinned });
    if (!result.ok) setStatus(result.error, true);
    else await refresh();
    return;
  }
  if (action === 'copy') {
    if (!entry.text) return;
    await navigator.clipboard.writeText(entry.text);
    buttonEl.textContent = 'Copied';
    return;
  }
  if (action === 'restore') {
    if (tabId == null) {
      setStatus('Open a page with a text field first.', true);
      return;
    }
    const result = await rpc({ type: 'restore', tabId, id: entry.id });
    if (!result.ok) setStatus(result.error, true);
    else setStatus('Restored into the focused field.');
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.settings && !changes.entries && !changes.crypto)) return;
  if (document.activeElement === unlockPass || document.activeElement === q) return;
  void refresh();
});

void chrome.commands.getAll().then((commands) => {
  const command = commands.find((item) => item.name === 'restore-typed-text');
  const keys = command?.shortcut || 'Ctrl+Shift+Y';
  shortcut.replaceChildren();
  shortcut.append('Shortcut ');
  const kbd = document.createElement('kbd');
  kbd.textContent = keys;
  shortcut.append(kbd);
});

void refresh();
