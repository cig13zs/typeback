import { describe, expect, it } from 'vitest';
import { enforceCap, isExpired, partitionRetention } from '../../src/lib/retention';

const day = 24 * 60 * 60 * 1000;

describe('retention', () => {
  it('drops drafts older than the window and keeps pinned ones', () => {
    const entries = [
      { id: 'fresh', updatedAt: 6 * day, pinned: false },
      { id: 'edge', updatedAt: 0, pinned: false },
      { id: 'old', updatedAt: 0, pinned: false },
      { id: 'kept', updatedAt: 0, pinned: true },
    ];
    expect(isExpired(entries[1]!, 7, 7 * day)).toBe(false);
    expect(isExpired(entries[2]!, 7, 7 * day + 1)).toBe(true);
    expect(isExpired(entries[3]!, 7, 30 * day)).toBe(false);
    const { keep, drop } = partitionRetention(entries, 7, 7 * day + 1);
    expect(keep.map((entry) => entry.id)).toEqual(['fresh', 'kept']);
    expect(drop.map((entry) => entry.id)).toEqual(['edge', 'old']);
  });

  it('keeps everything when retention is 0', () => {
    expect(isExpired({ id: 'a', updatedAt: 0, pinned: false }, 0, day)).toBe(false);
  });

  it('evicts the oldest unpinned drafts past the cap and never evicts pins', () => {
    const entries = [
      { id: 'p1', pinned: true, updatedAt: 1 },
      { id: 'p2', pinned: true, updatedAt: 2 },
      { id: 'p3', pinned: true, updatedAt: 3 },
      { id: 'new', pinned: false, updatedAt: 10 },
      { id: 'old', pinned: false, updatedAt: 4 },
    ];
    const { keep, drop } = enforceCap(entries, 2);
    expect(keep.map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3']);
    expect(drop.map((entry) => entry.id)).toEqual(['new', 'old']);
  });
});
