import copy from '../copy.json';
import { findEditable } from '../lib/editable';
import { identifyField } from '../lib/field-identity';
import { readFieldText, writeFieldText } from '../lib/field-value';
import { isSavableField } from '../lib/sensitive';
import type { EntryView, ExtensionStatus, SaveResult } from '../lib/types';
import { MAX_TEXT_CHARS } from '../lib/types';
import { pageKey } from '../lib/url';
import { rpc } from '../ui/rpc';
import { RestoreUi, type RestoreChoice } from './ui';

const DEBOUNCE_MS = 500;
const started = Symbol.for('typeback.listening');

interface FlaggedGlobal {
  [started]?: boolean;
}

function frameHref(): string {
  const href = location.href;
  if ((href === 'about:srcdoc' || href === 'about:blank') && window.parent !== window) {
    try {
      const parentHref = window.parent.location.href;
      if (parentHref.startsWith('http://') || parentHref.startsWith('https://')) return parentHref;
    } catch {
      /* parent is cross-origin */
    }
  }
  return href;
}

function visuallyHidden(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute('type') === 'hidden') return true;
  const style = getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden';
}

function choicesOf(entry: EntryView): RestoreChoice[] {
  if (!entry.text) return [];
  const choices: RestoreChoice[] = [{ text: entry.text, savedAt: entry.updatedAt, latest: true }];
  for (const version of [...entry.versions].reverse()) {
    if (!version.text || version.text === entry.text) continue;
    choices.push({ text: version.text, savedAt: version.savedAt, latest: false });
  }
  return choices;
}

function main(): void {
  const ui = new RestoreUi(document);
  const timers = new WeakMap<HTMLElement, number>();
  const lastSaved = new WeakMap<HTMLElement, string>();
  let lastTarget: HTMLElement | null = null;
  let focusToken = 0;
  let paused = false;
  let blocked = false;

  function currentTarget(): HTMLElement | null {
    const active = findEditable(document.activeElement);
    if (active) return active;
    if (lastTarget?.isConnected) return lastTarget;
    return null;
  }

  async function refreshStatus(): Promise<void> {
    const page = pageKey(frameHref());
    if (!page) {
      blocked = true;
      return;
    }
    const response = await rpc<ExtensionStatus>({ type: 'getState', href: page.href });
    if (!response.ok) return;
    paused = response.data.paused;
    blocked = response.data.blocked;
  }

  async function flush(el: HTMLElement): Promise<void> {
    const pending = timers.get(el);
    if (pending) window.clearTimeout(pending);
    timers.delete(el);
    if (paused || blocked || !el.isConnected) return;
    if (!isSavableField(el) || visuallyHidden(el)) return;
    const text = readFieldText(el).slice(0, MAX_TEXT_CHARS);
    if (!text.trim() || lastSaved.get(el) === text) return;
    const page = pageKey(frameHref());
    if (!page) return;
    const signature = identifyField(el);
    const response = await rpc<SaveResult>({
      type: 'save',
      draft: {
        origin: page.origin,
        urlKey: page.urlKey,
        href: page.href,
        fieldKey: signature.fieldKey,
        label: signature.label,
        text,
      },
    });
    if (response.ok && response.data.saved) lastSaved.set(el, text);
    if (response.ok && response.data.skipped === 'queued') lastSaved.set(el, text);
  }

  function schedule(el: HTMLElement): void {
    const pending = timers.get(el);
    if (pending) window.clearTimeout(pending);
    timers.set(el, window.setTimeout(() => void flush(el), DEBOUNCE_MS));
  }

  async function showSaved(el: HTMLElement): Promise<void> {
    const token = ++focusToken;
    const page = pageKey(frameHref());
    if (!page) return;
    const signature = identifyField(el);
    const response = await rpc<{ entry: EntryView | null }>({
      type: 'queryField',
      origin: page.origin,
      urlKey: page.urlKey,
      fieldKey: signature.fieldKey,
    });
    if (token !== focusToken || currentTarget() !== el) return;
    if (!response.ok || !response.data.entry) {
      ui.hide();
      return;
    }
    const entry = response.data.entry;
    if (entry.locked || entry.text == null) {
      ui.showChip(el, copy.unlockChip, () => {
        ui.showNote(el, 'Open Typeback and enter your passphrase to restore this draft.');
      });
      return;
    }
    const choices = choicesOf(entry);
    const label = choices.length > 1 ? `${copy.chipLabel} (${choices.length})` : copy.chipLabel;
    ui.showChip(el, label, () => ui.openPanel(el, choices, (text) => writeFieldText(el, text)));
  }

  function onFocus(el: HTMLElement): void {
    lastTarget = el;
    void rpc({ type: 'focus' });
    if (readFieldText(el).trim()) {
      ui.hide();
      return;
    }
    void showSaved(el);
  }

  async function openRestore(): Promise<{ ok: boolean; error?: string }> {
    const target = currentTarget();
    if (!target) return { ok: false, error: 'Focus a text field first.' };
    lastTarget = target;
    const page = pageKey(frameHref());
    if (!page) return { ok: false, error: 'This page is not available to Typeback.' };
    const signature = identifyField(target);
    const response = await rpc<{ entry: EntryView | null }>({
      type: 'queryField',
      origin: page.origin,
      urlKey: page.urlKey,
      fieldKey: signature.fieldKey,
    });
    if (!response.ok) return { ok: false, error: response.error };
    const entry = response.data.entry;
    if (!entry) {
      ui.showNote(target, 'Nothing saved for this field yet.');
      return { ok: true };
    }
    if (entry.locked || entry.text == null) {
      ui.showNote(target, 'Unlock Typeback to restore this draft.');
      return { ok: true };
    }
    ui.openPanel(target, choicesOf(entry), (text) => writeFieldText(target, text));
    return { ok: true };
  }

  document.addEventListener(
    'input',
    (event) => {
      const path = event.composedPath();
      if (ui.containsTarget(path[0] ?? null)) return;
      const el = findEditable(path[0] ?? null);
      if (!el) return;
      ui.hide();
      schedule(el);
    },
    true,
  );

  document.addEventListener(
    'focusin',
    (event) => {
      const el = findEditable(event.composedPath()[0] ?? null);
      if (!el || ui.containsTarget(event.target)) return;
      onFocus(el);
    },
    true,
  );

  document.addEventListener(
    'focusout',
    (event) => {
      const el = findEditable(event.composedPath()[0] ?? null);
      if (el) void flush(el);
    },
    true,
  );

  document.addEventListener(
    'contextmenu',
    (event) => {
      const el = findEditable(event.composedPath()[0] ?? null);
      if (el) lastTarget = el;
    },
    true,
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && lastTarget) void flush(lastTarget);
  });
  window.addEventListener('pagehide', () => {
    if (lastTarget) void flush(lastTarget);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.crypto)) void refreshStatus();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void sender;
    if (!message || typeof message !== 'object') return;
    const type = (message as { type?: string }).type;
    if (type === 'where') {
      sendResponse({ ok: true, href: frameHref() });
      return;
    }
    if (type === 'openRestore') {
      void openRestore().then(sendResponse);
      return true;
    }
    if (type === 'applyText') {
      const target = currentTarget();
      const text = typeof (message as { text?: unknown }).text === 'string' ? (message as { text: string }).text : '';
      if (!target || !text) {
        sendResponse({ ok: false });
        return;
      }
      writeFieldText(target, text);
      ui.hide();
      sendResponse({ ok: true });
    }
  });

  void refreshStatus();
}

const globalFlag = globalThis as typeof globalThis & FlaggedGlobal;
if (!globalFlag[started]) {
  globalFlag[started] = true;
  main();
}
