import type { DraftRecord, SaveDraft } from './types';
import { MAX_TEXT_CHARS } from './types';

export interface SaveMergeInput extends SaveDraft {
  id: string;
  now: number;
  maxVersions: number;
  maxChars?: number;
}

/** Merge a keystroke snapshot into the field's version history. Empty text never wipes a draft. */
export function applySave(existing: DraftRecord | undefined, input: SaveMergeInput): DraftRecord | null {
  const maxChars = input.maxChars ?? MAX_TEXT_CHARS;
  const text = input.text.slice(0, maxChars);
  if (!text.trim()) return existing ?? null;
  if (!existing) {
    return {
      id: input.id,
      origin: input.origin,
      urlKey: input.urlKey,
      href: input.href,
      fieldKey: input.fieldKey,
      label: input.label,
      text,
      versions: [],
      createdAt: input.now,
      updatedAt: input.now,
      pinned: false,
    };
  }
  if (existing.text === text) {
    return {
      ...existing,
      href: input.href,
      label: input.label || existing.label,
      updatedAt: input.now,
    };
  }
  const versions = [...existing.versions, { text: existing.text, savedAt: existing.updatedAt }];
  const cap = Math.max(1, input.maxVersions);
  return {
    ...existing,
    href: input.href,
    label: input.label || existing.label,
    text,
    versions: versions.slice(-cap),
    updatedAt: input.now,
  };
}
