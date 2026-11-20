import { describe, expect, it } from 'vitest';
import { applySave } from '../../src/lib/history';
import type { SaveDraft } from '../../src/lib/types';

const draft: SaveDraft = {
  origin: 'https://notes.example',
  urlKey: '/post',
  href: 'https://notes.example/post',
  fieldKey: 'tag:textarea|name:comment',
  label: 'Comment',
  text: 'first',
};

function save(text: string, now: number, id = '1') {
  return { ...draft, text, id, now, maxVersions: 2, maxChars: 20 };
}

describe('version history', () => {
  it('keeps earlier text when the draft changes and ignores empty wipes', () => {
    const created = applySave(undefined, save('first', 10));
    expect(created?.versions).toEqual([]);
    const same = applySave(created ?? undefined, save('first', 20));
    expect(same?.updatedAt).toBe(20);
    expect(same?.versions).toEqual([]);
    const next = applySave(same ?? undefined, save('second', 30));
    expect(next?.text).toBe('second');
    expect(next?.versions).toEqual([{ text: 'first', savedAt: 20 }]);
    const third = applySave(next ?? undefined, save('third', 40));
    expect(third?.versions.map((version) => version.text)).toEqual(['first', 'second']);
    const fourth = applySave(third ?? undefined, save('fourth', 50));
    expect(fourth?.versions.map((version) => version.text)).toEqual(['second', 'third']);
    expect(applySave(fourth ?? undefined, save('   ', 60))?.text).toBe('fourth');
    expect(applySave(undefined, save('   ', 60))).toBeNull();
  });

  it('clips oversized snapshots', () => {
    const saved = applySave(undefined, save('1234567890abcdefghijEXTRA', 1));
    expect(saved?.text).toBe('1234567890abcdefghij');
  });
});
