import copy from '../copy.json';
import { createRepository, type Repository } from '../lib/repository';
import type {
  BackupFile,
  EntryView,
  ExtensionStatus,
  SaveDraft,
  Settings,
} from '../lib/types';
import type { Rpc } from '../ui/rpc';

interface FocusMemo {
  frameId: number;
  at: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(error: unknown): Rpc<never> {
  if (error instanceof Error && error.message) return { ok: false, error: error.message };
  return { ok: false, error: 'Something went wrong.' };
}

function chromeKv() {
  return {
    async get(keys: string[]) {
      return chrome.storage.local.get(keys);
    },
    async set(values: Record<string, unknown>) {
      await chrome.storage.local.set(values);
    },
  };
}

function chromeSession() {
  const passkey = 'passphrase';
  const pendingKey = 'pending';
  return {
    async getPassphrase() {
      const stored = await chrome.storage.session.get(passkey);
      return typeof stored[passkey] === 'string' ? stored[passkey] : null;
    },
    async setPassphrase(value: string | null) {
      if (value == null) await chrome.storage.session.remove(passkey);
      else await chrome.storage.session.set({ [passkey]: value });
    },
    async getPending() {
      const stored = await chrome.storage.session.get(pendingKey);
      return Array.isArray(stored[pendingKey]) ? stored[pendingKey] : [];
    },
    async setPending(drafts: unknown[]) {
      await chrome.storage.session.set({ [pendingKey]: drafts });
    },
  };
}

function parseDraft(value: unknown): SaveDraft | null {
  if (!isRecord(value)) return null;
  const fields = ['origin', 'urlKey', 'href', 'fieldKey', 'label', 'text'] as const;
  const draft: Partial<SaveDraft> = {};
  for (const field of fields) {
    if (typeof value[field] !== 'string') return null;
    draft[field] = value[field];
  }
  return draft as SaveDraft;
}

function parseSettings(value: unknown): Partial<Settings> {
  if (!isRecord(value)) return {};
  const partial: Partial<Settings> = {};
  if (typeof value.paused === 'boolean') partial.paused = value.paused;
  if (typeof value.retentionDays === 'number') partial.retentionDays = value.retentionDays;
  if (typeof value.maxVersions === 'number') partial.maxVersions = value.maxVersions;
  if (typeof value.entryCap === 'number') partial.entryCap = value.entryCap;
  if (Array.isArray(value.blocklist)) partial.blocklist = value.blocklist.map((item) => String(item));
  return partial;
}

function focusKey(tabId: number): string {
  return `focus:${tabId}`;
}

async function readFocus(tabId: number): Promise<FocusMemo | null> {
  const stored = await chrome.storage.session.get(focusKey(tabId));
  const memo = stored[focusKey(tabId)];
  if (!isRecord(memo) || typeof memo.frameId !== 'number') return null;
  return { frameId: memo.frameId, at: Number(memo.at) || 0 };
}

async function writeFocus(tabId: number, frameId: number): Promise<void> {
  const memo: FocusMemo = { frameId, at: Date.now() };
  await chrome.storage.session.set({ [focusKey(tabId)]: memo });
}

const repo: Repository = createRepository({
  kv: chromeKv(),
  session: chromeSession(),
});

async function refreshBadge(): Promise<void> {
  const status = await repo.statusFor('http://localhost/');
  if (status.encryptionEnabled && !status.unlocked) {
    await chrome.action.setBadgeText({ text: 'L' });
    await chrome.action.setBadgeBackgroundColor({ color: '#E36A45' });
    await chrome.action.setTitle({
      title: `${copy.storeName} (locked)`,
    });
    return;
  }
  if (status.paused) {
    await chrome.action.setBadgeText({ text: 'P' });
    await chrome.action.setBadgeBackgroundColor({ color: '#5E675F' });
    await chrome.action.setTitle({ title: `${copy.storeName} (paused)` });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: copy.storeName });
}

async function ensureContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'typeback-restore',
    title: copy.restoreMenu,
    contexts: ['editable'],
  });
}

async function restoreIntoTab(tabId: number, id: string): Promise<Rpc<{ restored: true }>> {
  const view = await repo.getById(id);
  if (!view) return { ok: false, error: 'That draft is gone.' };
  if (view.locked || view.text == null) {
    return { ok: false, error: 'Unlock Typeback to restore this draft.' };
  }
  const memo = await readFocus(tabId);
  try {
    const response: unknown = await chrome.tabs.sendMessage(
      tabId,
      { type: 'applyText', text: view.text },
      memo ? { frameId: memo.frameId } : undefined,
    );
    if (!isRecord(response) || response.ok !== true) {
      return { ok: false, error: 'Focus a text field on the page first.' };
    }
    return { ok: true, data: { restored: true } };
  } catch {
    return { ok: false, error: 'Focus a text field on the page first.' };
  }
}

async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<Rpc<unknown>> {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return { ok: false, error: 'Unknown request.' };
  }
  switch (message.type) {
    case 'getState': {
      const href = typeof message.href === 'string' ? message.href : 'http://localhost/';
      const status: ExtensionStatus = await repo.statusFor(href);
      return { ok: true, data: status };
    }
    case 'getSettings': {
      const settings = await repo.getSettings();
      const status = await repo.statusFor('http://localhost/');
      return {
        ok: true,
        data: { settings, encryptionEnabled: status.encryptionEnabled, unlocked: status.unlocked },
      };
    }
    case 'save': {
      const draft = parseDraft(message.draft);
      if (!draft) return { ok: false, error: 'Incomplete draft.' };
      return { ok: true, data: await repo.save(draft) };
    }
    case 'queryField': {
      if (
        typeof message.origin !== 'string' ||
        typeof message.urlKey !== 'string' ||
        typeof message.fieldKey !== 'string'
      ) {
        return { ok: false, error: 'Unknown field.' };
      }
      const entry: EntryView | null = await repo.getField(message.origin, message.urlKey, message.fieldKey);
      return { ok: true, data: { entry } };
    }
    case 'list': {
      const entries = await repo.list({
        origin: typeof message.origin === 'string' ? message.origin : undefined,
        urlKey: typeof message.urlKey === 'string' ? message.urlKey : undefined,
        search: typeof message.search === 'string' ? message.search : undefined,
      });
      return { ok: true, data: { entries } };
    }
    case 'remove': {
      if (typeof message.id !== 'string') return { ok: false, error: 'Missing draft.' };
      await repo.remove(message.id);
      return { ok: true, data: null };
    }
    case 'pin': {
      if (typeof message.id !== 'string' || typeof message.pinned !== 'boolean') {
        return { ok: false, error: 'Missing draft.' };
      }
      await repo.setPinned(message.id, message.pinned);
      return { ok: true, data: null };
    }
    case 'focus': {
      if (sender.tab?.id == null || sender.frameId == null) return { ok: true, data: null };
      await writeFocus(sender.tab.id, sender.frameId);
      return { ok: true, data: null };
    }
    case 'restore': {
      if (typeof message.tabId !== 'number' || typeof message.id !== 'string') {
        return { ok: false, error: 'Missing draft.' };
      }
      return restoreIntoTab(message.tabId, message.id);
    }
    case 'updateSettings': {
      const settings = await repo.updateSettings(parseSettings(message.settings));
      await refreshBadge();
      return { ok: true, data: settings };
    }
    case 'enableEncryption': {
      if (typeof message.passphrase !== 'string') return { ok: false, error: 'Enter a passphrase.' };
      await repo.enableEncryption(message.passphrase);
      await refreshBadge();
      return { ok: true, data: null };
    }
    case 'disableEncryption': {
      if (typeof message.passphrase !== 'string') return { ok: false, error: 'Enter the passphrase.' };
      await repo.disableEncryption(message.passphrase);
      await refreshBadge();
      return { ok: true, data: null };
    }
    case 'changePassphrase': {
      if (typeof message.current !== 'string' || typeof message.next !== 'string') {
        return { ok: false, error: 'Enter both passphrases.' };
      }
      await repo.changePassphrase(message.current, message.next);
      return { ok: true, data: null };
    }
    case 'unlock': {
      if (typeof message.passphrase !== 'string') return { ok: false, error: 'Enter the passphrase.' };
      await repo.unlock(message.passphrase);
      await refreshBadge();
      return { ok: true, data: null };
    }
    case 'lock': {
      await repo.lock();
      await refreshBadge();
      return { ok: true, data: null };
    }
    case 'exportBackup': {
      const backup: BackupFile = await repo.exportBackup();
      return { ok: true, data: backup };
    }
    case 'importBackup': {
      const count = await repo.importBackup(message.backup as BackupFile);
      await refreshBadge();
      return { ok: true, data: { count } };
    }
    case 'usage': {
      const bytes = await chrome.storage.local.getBytesInUse(null);
      const stats = await repo.stats();
      return {
        ok: true,
        data: {
          bytes,
          quota: chrome.storage.local.QUOTA_BYTES,
          count: stats.count,
          pinned: stats.pinned,
        },
      };
    }
    case 'clearUnpinned': {
      const removed = await repo.clearUnpinned();
      return { ok: true, data: { removed } };
    }
    default:
      return { ok: false, error: 'Unknown request.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handle(message, sender).then(sendResponse, (error: unknown) => sendResponse(fail(error)));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
  void repo.cleanup();
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void repo.cleanup();
  void refreshBadge();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'restore-typed-text') return;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    const memo = await readFocus(tab.id);
    await chrome.tabs
      .sendMessage(tab.id, { type: 'openRestore' }, memo ? { frameId: memo.frameId } : undefined)
      .catch(() => undefined);
  })();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'typeback-restore' || tab?.id == null) return;
  const frameId = typeof info.frameId === 'number' ? info.frameId : undefined;
  void chrome.tabs
    .sendMessage(tab.id, { type: 'openRestore' }, frameId == null ? undefined : { frameId })
    .catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'typeback-cleanup') void repo.cleanup();
});

void chrome.alarms.create('typeback-cleanup', { periodInMinutes: 60 });
void refreshBadge();
