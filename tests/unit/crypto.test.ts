import { describe, expect, it } from 'vitest';
import {
  DecryptError,
  PBKDF2_ITERATIONS,
  createVault,
  decryptWithKey,
  encryptWithKey,
  unlockKey,
} from '../../src/lib/crypto';

describe('encryption at rest', () => {
  it('uses a production PBKDF2 work factor', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });

  it('round-trips text and rejects the wrong passphrase', async () => {
    const header = await createVault('correct horse', 1_000);
    const key = await unlockKey('correct horse', header);
    const blob = await encryptWithKey('café — kiln schedule', key);
    expect(await decryptWithKey(blob, key)).toBe('café — kiln schedule');
    await expect(unlockKey('wrong horse', header)).rejects.toBeInstanceOf(DecryptError);
  });

  it('uses a fresh iv so two saves of the same text differ', async () => {
    const header = await createVault('correct horse', 1_000);
    const key = await unlockKey('correct horse', header);
    const first = await encryptWithKey('same words', key);
    const second = await encryptWithKey('same words', key);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('fails closed when ciphertext is tampered with', async () => {
    const header = await createVault('correct horse', 1_000);
    const key = await unlockKey('correct horse', header);
    const blob = await encryptWithKey('private note', key);
    const flipped = blob.ciphertext.slice(0, -2) + (blob.ciphertext.endsWith('a') ? 'b' : 'a');
    await expect(decryptWithKey({ ...blob, ciphertext: flipped }, key)).rejects.toBeInstanceOf(DecryptError);
  });
});
