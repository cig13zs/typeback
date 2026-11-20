import type { EncryptedBlob, VaultHeader } from './crypto';

export interface Version {
  text: string;
  savedAt: number;
}

export interface Settings {
  paused: boolean;
  retentionDays: number;
  blocklist: string[];
  maxVersions: number;
  entryCap: number;
}

export interface CryptoState {
  enabled: boolean;
  header?: VaultHeader;
}

/** Plaintext draft used while merging version history. */
export interface DraftRecord {
  id: string;
  origin: string;
  urlKey: string;
  href: string;
  fieldKey: string;
  label: string;
  text: string;
  versions: Version[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

/** What is written to chrome.storage.local. Text is omitted when encrypted. */
export interface StoredEntry {
  id: string;
  origin: string;
  urlKey: string;
  href: string;
  fieldKey: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  encrypted: boolean;
  charCount: number;
  text?: string;
  versions?: Version[];
  payload?: EncryptedBlob;
}

export interface PendingDraft {
  origin: string;
  urlKey: string;
  href: string;
  fieldKey: string;
  label: string;
  text: string;
  updatedAt: number;
  pinned: boolean;
}

export interface SaveDraft {
  origin: string;
  urlKey: string;
  href: string;
  fieldKey: string;
  label: string;
  text: string;
}

export interface EntryView {
  id: string;
  origin: string;
  urlKey: string;
  href: string;
  fieldKey: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  encrypted: boolean;
  locked: boolean;
  charCount: number;
  text: string | null;
  versions: Version[];
}

export interface ExtensionStatus {
  paused: boolean;
  blocked: boolean;
  retentionDays: number;
  encryptionEnabled: boolean;
  unlocked: boolean;
  hostname: string;
}

export interface SaveResult {
  saved: boolean;
  skipped?: 'paused' | 'blocked' | 'empty' | 'queued';
}

export interface BackupFile {
  typeback: 1;
  exportedAt: string;
  settings: Settings;
  crypto: CryptoState;
  entries: StoredEntry[];
}

export interface FieldSignature {
  fieldKey: string;
  label: string;
}

export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_MAX_VERSIONS = 10;
export const DEFAULT_ENTRY_CAP = 400;
export const MAX_TEXT_CHARS = 100_000;
export const MIN_PASSPHRASE_LENGTH = 8;

export const STORAGE_KEYS = {
  settings: 'settings',
  entries: 'entries',
  crypto: 'crypto',
} as const;
