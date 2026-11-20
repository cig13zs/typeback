export interface RetentionEntry {
  id: string;
  updatedAt: number;
  pinned: boolean;
}

export function isExpired(entry: RetentionEntry, retentionDays: number, now: number): boolean {
  if (entry.pinned) return false;
  if (retentionDays <= 0) return false;
  const maxAge = retentionDays * 24 * 60 * 60 * 1000;
  return now - entry.updatedAt > maxAge;
}

export function partitionRetention<T extends RetentionEntry>(
  entries: readonly T[],
  retentionDays: number,
  now: number,
): { keep: T[]; drop: T[] } {
  const keep: T[] = [];
  const drop: T[] = [];
  for (const entry of entries) {
    if (isExpired(entry, retentionDays, now)) drop.push(entry);
    else keep.push(entry);
  }
  return { keep, drop };
}

/** Pinned drafts are never evicted. Oldest unpinned drafts go first once `cap` is exceeded. */
export function enforceCap<T extends RetentionEntry>(
  entries: readonly T[],
  cap: number,
): { keep: T[]; drop: T[] } {
  const pinned = entries.filter((entry) => entry.pinned);
  const rest = entries
    .filter((entry) => !entry.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const room = Math.max(0, cap - pinned.length);
  return {
    keep: [...pinned, ...rest.slice(0, room)],
    drop: rest.slice(room),
  };
}
