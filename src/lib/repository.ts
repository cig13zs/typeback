import { hostBlocked } from './blocklist';
import { DecryptError, createVault, decryptWithKey, encryptWithKey, unlockKey } from './crypto';
import { applySave } from './history';
import { enforceCap, isExpired, partitionRetention } from './retention';
import { normalizeSettings } from './settings';
import {
  MAX_TEXT_CHARS,
  MIN_PASSPHRASE_LENGTH,
  STORAGE_KEYS,
  type BackupFile,
  type CryptoState,
  type DraftRecord,
  type EntryView,
  type ExtensionStatus,
  type PendingDraft,
  type SaveDraft,
  type SaveResult,
  type Settings,
  type StoredEntry,
  type Version,
} from './types';
import { isWebOrigin, pageKey } from './url';

type AesKey = CryptoKey;

export interface Kv {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export interface SessionStore {
  getPassphrase(): Promise<string | null>;
  setPassphrase(value: string | null): Promise<void>;
  getPending(): Promise<PendingDraft[]>;
  setPending(drafts: PendingDraft[]): Promise<void>;
}

export interface RepositoryDeps {
  kv: Kv;
  session: SessionStore;
  now?: () => number;
  createId?: () => string;
  /** Test hook. Production uses the default inside createVault. */
  iterations?: number;
}

export interface ListQuery {
  origin?: string;
  urlKey?: string;
  search?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function pendingKey(draft: Pick<PendingDraft, 'origin' | 'urlKey' | 'fieldKey'>): string {
  return `${draft.origin}\n${draft.urlKey}\n${draft.fieldKey}`;
}

function pendingId(draft: Pick<PendingDraft, 'origin' | 'urlKey' | 'fieldKey'>): string {
  return `pending:${encodeURIComponent(draft.origin)}|${encodeURIComponent(draft.urlKey)}|${encodeURIComponent(draft.fieldKey)}`;
}

function sameField(
  entry: { origin: string; urlKey: string; fieldKey: string },
  draft: { origin: string; urlKey: string; fieldKey: string },
): boolean {
  return entry.origin === draft.origin && entry.urlKey === draft.urlKey && entry.fieldKey === draft.fieldKey;
}

function sanitizeVersions(value: unknown): Version[] {
  if (!Array.isArray(value)) return [];
  const versions: Version[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.text !== 'string') continue;
    const savedAt = Number(item.savedAt);
    versions.push({
      text: item.text.slice(0, MAX_TEXT_CHARS),
      savedAt: Number.isFinite(savedAt) ? savedAt : 0,
    });
  }
  return versions.slice(-50);
}

export function sanitizeStoredEntry(value: unknown): StoredEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.fieldKey !== 'string') return null;
  if (typeof value.origin !== 'string' || typeof value.urlKey !== 'string') return null;
  if (!isWebOrigin(value.origin)) return null;
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  const encrypted = value.encrypted === true;
  const payload = isRecord(value.payload) &&
    typeof value.payload.iv === 'string' &&
    typeof value.payload.ciphertext === 'string'
    ? { iv: value.payload.iv, ciphertext: value.payload.ciphertext }
    : undefined;
  const text = typeof value.text === 'string' ? value.text.slice(0, MAX_TEXT_CHARS) : undefined;
  return {
    id: clip(value.id, 200),
    origin: clip(value.origin, 300),
    urlKey: clip(value.urlKey, 2000),
    href: clip(typeof value.href === 'string' ? value.href : value.origin, 2000),
    fieldKey: clip(value.fieldKey, 500),
    label: clip(typeof value.label === 'string' ? value.label : 'Text field', 200),
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    pinned: value.pinned === true,
    encrypted,
    charCount: text ? text.length : Number(value.charCount) || 0,
    text: encrypted ? undefined : text,
    versions: encrypted ? undefined : sanitizeVersions(value.versions),
    payload: encrypted ? payload : undefined,
  };
}

export function createRepository(deps: RepositoryDeps) {
  const now = deps.now ?? (() => Date.now());
  const createId = deps.createId ?? (() => crypto.randomUUID());
  let queue: Promise<unknown> = Promise.resolve();
  let cached: { passphrase: string; key: AesKey } | null = null;

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readBag(): Promise<{
    settings: Settings;
    entries: StoredEntry[];
    cryptoState: CryptoState;
  }> {
    const stored = await deps.kv.get([
      STORAGE_KEYS.settings,
      STORAGE_KEYS.entries,
      STORAGE_KEYS.crypto,
    ]);
    const entryBag = stored[STORAGE_KEYS.entries];
    const entries = isRecord(entryBag)
      ? Object.values(entryBag)
          .map((item) => sanitizeStoredEntry(item))
          .filter((item): item is StoredEntry => item !== null)
      : [];
    const cryptoRaw = stored[STORAGE_KEYS.crypto];
    let cryptoState: CryptoState = { enabled: false };
    if (isRecord(cryptoRaw) && cryptoRaw.enabled === true && isRecord(cryptoRaw.header)) {
      const header = cryptoRaw.header;
      const verifier = isRecord(header.verifier) ? header.verifier : null;
      if (
        typeof header.salt === 'string' &&
        typeof header.iterations === 'number' &&
        verifier &&
        typeof verifier.iv === 'string' &&
        typeof verifier.ciphertext === 'string'
      ) {
        cryptoState = {
          enabled: true,
          header: {
            salt: header.salt,
            iterations: header.iterations,
            verifier: { iv: verifier.iv, ciphertext: verifier.ciphertext },
          },
        };
      }
    }
    return {
      settings: normalizeSettings(stored[STORAGE_KEYS.settings]),
      entries,
      cryptoState,
    };
  }

  async function writeEntries(entries: StoredEntry[]): Promise<void> {
    const bag: Record<string, StoredEntry> = {};
    for (const entry of entries) bag[entry.id] = entry;
    await deps.kv.set({ [STORAGE_KEYS.entries]: bag });
  }

  async function writeSettings(settings: Settings): Promise<void> {
    await deps.kv.set({ [STORAGE_KEYS.settings]: settings });
  }

  async function writeCrypto(state: CryptoState): Promise<void> {
    await deps.kv.set({ [STORAGE_KEYS.crypto]: state });
  }

  function forgetKey(): void {
    cached = null;
  }

  async function getKey(state: CryptoState): Promise<AesKey | null> {
    if (!state.enabled || !state.header) return null;
    const passphrase = await deps.session.getPassphrase();
    if (!passphrase) return null;
    if (cached && cached.passphrase === passphrase) return cached.key;
    const key = await unlockKey(passphrase, state.header);
    cached = { passphrase, key };
    return key;
  }

  async function storedToDraft(entry: StoredEntry, key: AesKey | null): Promise<DraftRecord | null> {
    if (!entry.encrypted) {
      return {
        id: entry.id,
        origin: entry.origin,
        urlKey: entry.urlKey,
        href: entry.href,
        fieldKey: entry.fieldKey,
        label: entry.label,
        text: entry.text ?? '',
        versions: entry.versions ?? [],
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        pinned: entry.pinned,
      };
    }
    if (!key || !entry.payload) return null;
    try {
      const parsed = JSON.parse(await decryptWithKey(entry.payload, key)) as {
        text?: string;
        versions?: Version[];
      };
      return {
        id: entry.id,
        origin: entry.origin,
        urlKey: entry.urlKey,
        href: entry.href,
        fieldKey: entry.fieldKey,
        label: entry.label,
        text: typeof parsed.text === 'string' ? parsed.text : '',
        versions: sanitizeVersions(parsed.versions),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        pinned: entry.pinned,
      };
    } catch {
      return null;
    }
  }

  async function draftToStored(draft: DraftRecord, key: AesKey | null, encrypted: boolean): Promise<StoredEntry> {
    const base: StoredEntry = {
      id: draft.id,
      origin: draft.origin,
      urlKey: draft.urlKey,
      href: draft.href,
      fieldKey: draft.fieldKey,
      label: clip(draft.label || 'Text field', 200),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      pinned: draft.pinned,
      encrypted,
      charCount: draft.text.length,
    };
    if (!encrypted || !key) {
      return { ...base, encrypted: false, text: draft.text, versions: draft.versions };
    }
    const payload = await encryptWithKey(
      JSON.stringify({ text: draft.text, versions: draft.versions }),
      key,
    );
    return { ...base, encrypted: true, payload };
  }

  function upsert(entries: StoredEntry[], entry: StoredEntry): StoredEntry[] {
    const next = entries.filter((item) => item.id !== entry.id && !sameField(item, entry));
    next.push(entry);
    return next;
  }

  async function applyCap(entries: StoredEntry[], settings: Settings): Promise<StoredEntry[]> {
    const expired = partitionRetention(entries, settings.retentionDays, now());
    const capped = enforceCap(expired.keep, settings.entryCap);
    return capped.keep;
  }

  async function flushPending(entries: StoredEntry[], state: CryptoState, key: AesKey): Promise<StoredEntry[]> {
    const pending = await deps.session.getPending();
    if (pending.length === 0) return entries;
    const settings = (await readBag()).settings;
    let next = entries;
    for (const item of pending) {
      const match = next.find((entry) => sameField(entry, item));
      const existing = match ? await storedToDraft(match, key) : undefined;
      const merged = applySave(existing ?? undefined, {
        ...item,
        id: match?.id ?? createId(),
        now: item.updatedAt,
        maxVersions: settings.maxVersions,
      });
      if (!merged) continue;
      if (item.pinned || existing?.pinned) merged.pinned = true;
      const stored = await draftToStored(merged, key, state.enabled);
      next = upsert(next, stored);
    }
    await deps.session.setPending([]);
    return next;
  }

  function viewFromDraft(draft: DraftRecord, encrypted: boolean): EntryView {
    return {
      id: draft.id,
      origin: draft.origin,
      urlKey: draft.urlKey,
      href: draft.href,
      fieldKey: draft.fieldKey,
      label: draft.label,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      pinned: draft.pinned,
      encrypted,
      locked: false,
      charCount: draft.text.length,
      text: draft.text,
      versions: draft.versions,
    };
  }

  function lockedView(entry: StoredEntry): EntryView {
    return {
      id: entry.id,
      origin: entry.origin,
      urlKey: entry.urlKey,
      href: entry.href,
      fieldKey: entry.fieldKey,
      label: entry.label,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      pinned: entry.pinned,
      encrypted: true,
      locked: true,
      charCount: entry.charCount,
      text: null,
      versions: [],
    };
  }

  async function toView(entry: StoredEntry, key: AesKey | null): Promise<EntryView> {
    if (!entry.encrypted) {
      return viewFromDraft(
        {
          id: entry.id,
          origin: entry.origin,
          urlKey: entry.urlKey,
          href: entry.href,
          fieldKey: entry.fieldKey,
          label: entry.label,
          text: entry.text ?? '',
          versions: entry.versions ?? [],
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          pinned: entry.pinned,
        },
        false,
      );
    }
    const draft = await storedToDraft(entry, key);
    if (!draft) return lockedView(entry);
    return viewFromDraft(draft, true);
  }

  function overlayPending(views: EntryView[], pending: PendingDraft[], encrypted: boolean): EntryView[] {
    const byField = new Map(views.map((view) => [pendingKey(view), view]));
    for (const item of pending) {
      const key = pendingKey(item);
      const existing = byField.get(key);
      if (existing && existing.text !== null) {
        existing.text = item.text;
        existing.updatedAt = item.updatedAt;
        existing.charCount = item.text.length;
        existing.label = item.label || existing.label;
        existing.locked = false;
        if (item.pinned) existing.pinned = true;
        continue;
      }
      if (existing && existing.locked) {
        existing.text = item.text;
        existing.updatedAt = item.updatedAt;
        existing.charCount = item.text.length;
        existing.label = item.label || existing.label;
        existing.locked = false;
        if (item.pinned) existing.pinned = true;
        continue;
      }
      const view: EntryView = {
        id: pendingId(item),
        origin: item.origin,
        urlKey: item.urlKey,
        href: item.href,
        fieldKey: item.fieldKey,
        label: item.label || 'Text field',
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        pinned: item.pinned,
        encrypted,
        locked: false,
        charCount: item.text.length,
        text: item.text,
        versions: [],
      };
      byField.set(key, view);
    }
    return [...byField.values()];
  }

  function sortViews(views: EntryView[]): EntryView[] {
    return views.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  function matchesSearch(view: EntryView, search: string): boolean {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    const hay = [view.label, view.href, view.urlKey, view.origin, view.text ?? ''].join('\n').toLowerCase();
    return hay.includes(needle);
  }

  async function statusFor(href: string): Promise<ExtensionStatus> {
    const bag = await readBag();
    const page = pageKey(href);
    const hostname = page?.hostname ?? '';
    const passphrase = await deps.session.getPassphrase();
    return {
      paused: bag.settings.paused,
      blocked: page ? hostBlocked(hostname, bag.settings.blocklist) : false,
      retentionDays: bag.settings.retentionDays,
      encryptionEnabled: bag.cryptoState.enabled,
      unlocked: !bag.cryptoState.enabled || Boolean(passphrase),
      hostname,
    };
  }

  async function cleanupInner(): Promise<number> {
    const bag = await readBag();
    const kept = await applyCap(bag.entries, bag.settings);
    if (kept.length !== bag.entries.length) await writeEntries(kept);
    return bag.entries.length - kept.length;
  }

  async function listInner(query: ListQuery): Promise<EntryView[]> {
    const bag = await readBag();
    const key = await getKey(bag.cryptoState).catch(() => null);
    let entries = bag.entries;
    const kept = await applyCap(entries, bag.settings);
    if (kept.length !== entries.length) {
      await writeEntries(kept);
      entries = kept;
    }
    let views: EntryView[] = [];
    for (const entry of entries) views.push(await toView(entry, key));
    const pending = await deps.session.getPending();
    views = overlayPending(views, pending, bag.cryptoState.enabled);
    views = views.filter((view) => {
      if (query.origin && view.origin !== query.origin) return false;
      if (query.urlKey && view.urlKey !== query.urlKey) return false;
      if (query.search && !matchesSearch(view, query.search)) return false;
      return true;
    });
    return sortViews(views);
  }

  async function saveInner(draft: SaveDraft): Promise<SaveResult> {
    if (!isWebOrigin(draft.origin) || !draft.fieldKey) return { saved: false, skipped: 'empty' };
    const page = pageKey(draft.href);
    if (!page) return { saved: false, skipped: 'empty' };
    const bag = await readBag();
    if (bag.settings.paused) return { saved: false, skipped: 'paused' };
    if (hostBlocked(page.hostname, bag.settings.blocklist)) return { saved: false, skipped: 'blocked' };
    const text = draft.text.slice(0, MAX_TEXT_CHARS);
    if (!text.trim()) return { saved: false, skipped: 'empty' };
    const normalized: SaveDraft = {
      origin: page.origin,
      urlKey: page.urlKey,
      href: page.href,
      fieldKey: clip(draft.fieldKey, 500),
      label: clip(draft.label || 'Text field', 200),
      text,
    };
    if (bag.cryptoState.enabled) {
      const key = await getKey(bag.cryptoState).catch(() => null);
      if (!key) {
        const pending = await deps.session.getPending();
        const without = pending.filter((item) => pendingKey(item) !== pendingKey(normalized));
        without.push({
          ...normalized,
          updatedAt: now(),
          pinned: pending.find((item) => pendingKey(item) === pendingKey(normalized))?.pinned ?? false,
        });
        await deps.session.setPending(without);
        return { saved: false, skipped: 'queued' };
      }
      const match = bag.entries.find((entry) => sameField(entry, normalized));
      const existing = match ? await storedToDraft(match, key) : undefined;
      const merged = applySave(existing ?? undefined, {
        ...normalized,
        id: match?.id ?? createId(),
        now: now(),
        maxVersions: bag.settings.maxVersions,
      });
      if (!merged) return { saved: false, skipped: 'empty' };
      let entries = upsert(bag.entries, await draftToStored(merged, key, true));
      entries = await applyCap(entries, bag.settings);
      await writeEntries(entries);
      const pending = (await deps.session.getPending()).filter(
        (item) => pendingKey(item) !== pendingKey(normalized),
      );
      await deps.session.setPending(pending);
      return { saved: true };
    }
    const match = bag.entries.find((entry) => sameField(entry, normalized));
    const existing = match ? await storedToDraft(match, null) : undefined;
    const merged = applySave(existing ?? undefined, {
      ...normalized,
      id: match?.id ?? createId(),
      now: now(),
      maxVersions: bag.settings.maxVersions,
    });
    if (!merged) return { saved: false, skipped: 'empty' };
    let entries = upsert(bag.entries, await draftToStored(merged, null, false));
    entries = await applyCap(entries, bag.settings);
    await writeEntries(entries);
    return { saved: true };
  }

  async function requirePassphrase(passphrase: string): Promise<void> {
    if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
  }

  async function enableInner(passphrase: string): Promise<void> {
    await requirePassphrase(passphrase);
    const bag = await readBag();
    if (bag.cryptoState.enabled) throw new Error('Encryption is already on.');
    const header = await createVault(passphrase, deps.iterations);
    const key = await unlockKey(passphrase, header);
    const state: CryptoState = { enabled: true, header };
    let entries = bag.entries;
    const next: StoredEntry[] = [];
    for (const entry of entries) {
      const draft = await storedToDraft(entry, null);
      if (!draft) continue;
      next.push(await draftToStored(draft, key, true));
    }
    entries = await flushPending(next, state, key);
    await writeEntries(entries);
    await writeCrypto(state);
    await deps.session.setPassphrase(passphrase);
    cached = { passphrase, key };
  }

  async function disableInner(passphrase: string): Promise<void> {
    const bag = await readBag();
    if (!bag.cryptoState.enabled || !bag.cryptoState.header) return;
    const key = await unlockKey(passphrase, bag.cryptoState.header);
    const entries = await flushPending(bag.entries, bag.cryptoState, key);
    const next: StoredEntry[] = [];
    for (const entry of entries) {
      const draft = await storedToDraft(entry, key);
      if (!draft) throw new DecryptError('A draft could not be decrypted, so encryption was left on.');
      next.push(await draftToStored(draft, null, false));
    }
    await writeEntries(next);
    await writeCrypto({ enabled: false });
    await deps.session.setPassphrase(null);
    forgetKey();
  }

  async function unlockInner(passphrase: string): Promise<void> {
    const bag = await readBag();
    if (!bag.cryptoState.enabled || !bag.cryptoState.header) return;
    const key = await unlockKey(passphrase, bag.cryptoState.header);
    await deps.session.setPassphrase(passphrase);
    cached = { passphrase, key };
    const entries = await flushPending(bag.entries, bag.cryptoState, key);
    const kept = await applyCap(entries, bag.settings);
    await writeEntries(kept);
  }

  async function lockInner(): Promise<void> {
    const bag = await readBag();
    if (bag.cryptoState.enabled && bag.cryptoState.header) {
      const key = await getKey(bag.cryptoState).catch(() => null);
      if (key) {
        const entries = await flushPending(bag.entries, bag.cryptoState, key);
        await writeEntries(await applyCap(entries, bag.settings));
      }
    }
    await deps.session.setPassphrase(null);
    forgetKey();
  }

  async function changePassphraseInner(current: string, next: string): Promise<void> {
    await requirePassphrase(next);
    const bag = await readBag();
    if (!bag.cryptoState.enabled || !bag.cryptoState.header) {
      throw new Error('Turn encryption on first.');
    }
    const oldKey = await unlockKey(current, bag.cryptoState.header);
    const entries = await flushPending(bag.entries, bag.cryptoState, oldKey);
    const header = await createVault(next, deps.iterations);
    const newKey = await unlockKey(next, header);
    const rewritten: StoredEntry[] = [];
    for (const entry of entries) {
      const draft = await storedToDraft(entry, oldKey);
      if (!draft) throw new DecryptError();
      rewritten.push(await draftToStored(draft, newKey, true));
    }
    await writeEntries(rewritten);
    await writeCrypto({ enabled: true, header });
    await deps.session.setPassphrase(next);
    cached = { passphrase: next, key: newKey };
  }

  async function updateSettingsInner(partial: Partial<Settings>): Promise<Settings> {
    const bag = await readBag();
    const next = normalizeSettings({ ...bag.settings, ...partial });
    await writeSettings(next);
    const kept = await applyCap(bag.entries, next);
    if (kept.length !== bag.entries.length) await writeEntries(kept);
    return next;
  }

  async function removeInner(id: string): Promise<void> {
    const bag = await readBag();
    const pending = await deps.session.getPending();
    if (id.startsWith('pending:')) {
      await deps.session.setPending(pending.filter((item) => pendingId(item) !== id));
      return;
    }
    const target = bag.entries.find((entry) => entry.id === id);
    await writeEntries(bag.entries.filter((entry) => entry.id !== id));
    if (target) {
      await deps.session.setPending(pending.filter((item) => !sameField(target, item)));
    }
  }

  async function pinInner(id: string, pinned: boolean): Promise<void> {
    const bag = await readBag();
    if (id.startsWith('pending:')) {
      const pending = await deps.session.getPending();
      await deps.session.setPending(
        pending.map((item) => (pendingId(item) === id ? { ...item, pinned } : item)),
      );
      return;
    }
    await writeEntries(bag.entries.map((entry) => (entry.id === id ? { ...entry, pinned } : entry)));
  }

  async function getFieldInner(origin: string, urlKey: string, fieldKey: string): Promise<EntryView | null> {
    const bag = await readBag();
    const key = await getKey(bag.cryptoState).catch(() => null);
    const match = bag.entries.find(
      (entry) => entry.origin === origin && entry.urlKey === urlKey && entry.fieldKey === fieldKey,
    );
    const pending = (await deps.session.getPending()).find((item) => sameField(item, { origin, urlKey, fieldKey }));
    let view = match ? await toView(match, key) : null;
    if (pending) {
      view = overlayPending(view ? [view] : [], [pending], bag.cryptoState.enabled)[0] ?? null;
    }
    if (!view) return null;
    if (isExpired(view, bag.settings.retentionDays, now())) return null;
    return view;
  }

  async function getByIdInner(id: string): Promise<EntryView | null> {
    const views = await listInner({});
    return views.find((view) => view.id === id) ?? null;
  }

  async function exportInner(): Promise<BackupFile> {
    const bag = await readBag();
    return {
      typeback: 1,
      exportedAt: new Date(now()).toISOString(),
      settings: bag.settings,
      crypto: bag.cryptoState,
      entries: bag.entries,
    };
  }

  async function importInner(backup: BackupFile): Promise<number> {
    if (!isRecord(backup) || backup.typeback !== 1 || !Array.isArray(backup.entries)) {
      throw new Error('That file is not a Typeback backup.');
    }
    const incoming = backup.entries
      .map((item) => sanitizeStoredEntry(item))
      .filter((item): item is StoredEntry => item !== null);
    const settings = normalizeSettings(backup.settings);
    const entries = await applyCap(incoming, settings);
    await writeEntries(entries);
    await writeSettings(settings);
    if (backup.crypto?.enabled && backup.crypto.header) {
      await writeCrypto({ enabled: true, header: backup.crypto.header });
    } else {
      await writeCrypto({ enabled: false });
    }
    await deps.session.setPassphrase(null);
    forgetKey();
    return entries.length;
  }

  async function clearUnpinnedInner(): Promise<number> {
    const bag = await readBag();
    const kept = bag.entries.filter((entry) => entry.pinned);
    await writeEntries(kept);
    await deps.session.setPending((await deps.session.getPending()).filter((item) => item.pinned));
    return bag.entries.length - kept.length;
  }

  async function statsInner(): Promise<{ count: number; pinned: number }> {
    const bag = await readBag();
    return {
      count: bag.entries.length,
      pinned: bag.entries.filter((entry) => entry.pinned).length,
    };
  }

  return {
    statusFor: (href: string) => serial(() => statusFor(href)),
    list: (query: ListQuery) => serial(() => listInner(query)),
    getById: (id: string) => serial(() => getByIdInner(id)),
    getField: (origin: string, urlKey: string, fieldKey: string) =>
      serial(() => getFieldInner(origin, urlKey, fieldKey)),
    save: (draft: SaveDraft) => serial(() => saveInner(draft)),
    remove: (id: string) => serial(() => removeInner(id)),
    setPinned: (id: string, pinned: boolean) => serial(() => pinInner(id, pinned)),
    updateSettings: (partial: Partial<Settings>) => serial(() => updateSettingsInner(partial)),
    getSettings: () => serial(async () => (await readBag()).settings),
    enableEncryption: (passphrase: string) => serial(() => enableInner(passphrase)),
    disableEncryption: (passphrase: string) => serial(() => disableInner(passphrase)),
    changePassphrase: (current: string, next: string) => serial(() => changePassphraseInner(current, next)),
    unlock: (passphrase: string) => serial(() => unlockInner(passphrase)),
    lock: () => serial(() => lockInner()),
    cleanup: () => serial(() => cleanupInner()),
    exportBackup: () => serial(() => exportInner()),
    importBackup: (backup: BackupFile) => serial(() => importInner(backup)),
    clearUnpinned: () => serial(() => clearUnpinnedInner()),
    stats: () => serial(() => statsInner()),
  };
}

export type Repository = ReturnType<typeof createRepository>;

export function memoryKv(initial: Record<string, unknown> = {}): Kv & { snapshot(): Record<string, unknown> } {
  const data = { ...initial };
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const key of keys) out[key] = data[key];
      return out;
    },
    async set(values) {
      Object.assign(data, values);
    },
    snapshot() {
      return structuredClone(data);
    },
  };
}

export function memorySession(): SessionStore & { passphrase: string | null; pending: PendingDraft[] } {
  const session = {
    passphrase: null as string | null,
    pending: [] as PendingDraft[],
    async getPassphrase() {
      return session.passphrase;
    },
    async setPassphrase(value: string | null) {
      session.passphrase = value;
    },
    async getPending() {
      return session.pending.map((item) => ({ ...item }));
    },
    async setPending(drafts: PendingDraft[]) {
      session.pending = drafts.map((item) => ({ ...item }));
    },
  };
  return session;
}
