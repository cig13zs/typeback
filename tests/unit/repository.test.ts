import { describe, expect, it } from 'vitest';
import { createRepository, memoryKv, memorySession } from '../../src/lib/repository';
import type { SaveDraft } from '../../src/lib/types';

function setup() {
  const kv = memoryKv();
  const session = memorySession();
  let clock = 1_000;
  let n = 0;
  const repo = createRepository({
    kv,
    session,
    now: () => clock,
    createId: () => `id-${++n}`,
    iterations: 1_000,
  });
  return {
    repo,
    kv,
    session,
    setNow(value: number) {
      clock = value;
    },
  };
}

const draft: SaveDraft = {
  origin: 'https://notes.example',
  urlKey: '/post',
  href: 'https://notes.example/post',
  fieldKey: 'tag:textarea|name:comment|label:comment',
  label: 'Comment',
  text: 'kiln schedule for Thursday',
};

describe('repository', () => {
  it('saves version history and skips blocklisted hosts', async () => {
    const { repo } = setup();
    expect((await repo.save(draft)).saved).toBe(true);
    expect((await repo.save({ ...draft, text: '   ' })).skipped).toBe('empty');
    await repo.save({ ...draft, text: 'slow cool, do not rush the glaze' });
    const field = await repo.getField(draft.origin, draft.urlKey, draft.fieldKey);
    expect(field?.text).toBe('slow cool, do not rush the glaze');
    expect(field?.versions.map((version) => version.text)).toEqual(['kiln schedule for Thursday']);
    const blocked = await repo.save({
      ...draft,
      origin: 'https://www.chase.com',
      href: 'https://www.chase.com/account',
      text: 'routing 021000021',
    });
    expect(blocked).toEqual({ saved: false, skipped: 'blocked' });
  });

  it('expires old drafts, keeps pins, and can export without a passphrase', async () => {
    const { repo, setNow } = setup();
    setNow(0);
    await repo.save(draft);
    const listed = await repo.list({});
    await repo.setPinned(listed[0]!.id, true);
    setNow(8 * 24 * 60 * 60 * 1000);
    await repo.save({ ...draft, fieldKey: 'other', label: 'Other', text: 'still here' });
    expect((await repo.cleanup()) >= 0).toBe(true);
    const after = await repo.list({});
    expect(after.map((entry) => entry.label).sort()).toEqual(['Comment', 'Other']);
    const backup = await repo.exportBackup();
    expect(JSON.stringify(backup)).not.toContain('passphrase');
    expect(backup.typeback).toBe(1);
  });

  it('encrypts on disk, hides text while locked, and restores it with the passphrase', async () => {
    const { repo, kv, session } = setup();
    await repo.save(draft);
    await repo.enableEncryption('correct horse');
    expect(JSON.stringify(kv.snapshot())).not.toContain('kiln schedule');
    expect((await repo.getField(draft.origin, draft.urlKey, draft.fieldKey))?.text).toContain('kiln');
    await repo.lock();
    expect(session.passphrase).toBeNull();
    const locked = await repo.getField(draft.origin, draft.urlKey, draft.fieldKey);
    expect(locked?.locked).toBe(true);
    expect(locked?.text).toBeNull();
    await expect(repo.unlock('nope')).rejects.toThrow(/passphrase/i);
    await repo.unlock('correct horse');
    expect((await repo.getField(draft.origin, draft.urlKey, draft.fieldKey))?.text).toContain('kiln');
  });

  it('queues keystrokes in session memory when encryption is locked', async () => {
    const { repo, kv } = setup();
    await repo.enableEncryption('correct horse');
    await repo.lock();
    const saved = await repo.save({ ...draft, text: 'still in memory' });
    expect(saved.skipped).toBe('queued');
    expect(JSON.stringify(kv.snapshot())).not.toContain('still in memory');
    expect((await repo.getField(draft.origin, draft.urlKey, draft.fieldKey))?.text).toBe('still in memory');
    await repo.unlock('correct horse');
    expect(JSON.stringify(kv.snapshot())).not.toContain('still in memory');
    expect((await repo.getField(draft.origin, draft.urlKey, draft.fieldKey))?.text).toBe('still in memory');
  });

  it('replaces drafts on import', async () => {
    const { repo } = setup();
    await repo.save(draft);
    const backup = await repo.exportBackup();
    backup.entries[0]!.text = 'imported line';
    backup.entries[0]!.label = 'Imported';
    await repo.importBackup(backup);
    const listed = await repo.list({});
    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toBe('imported line');
  });
});
