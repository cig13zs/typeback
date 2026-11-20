export const PBKDF2_ITERATIONS = 210_000;
export const VAULT_CHECK = 'typeback-vault-ok-v1';

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

export interface VaultHeader {
  salt: string;
  iterations: number;
  verifier: EncryptedBlob;
}

export class DecryptError extends Error {
  constructor(message = 'Could not decrypt. The passphrase may be wrong.') {
    super(message);
    this.name = 'DecryptError';
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x1000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toBuffer(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithKey(plain: string, key: CryptoKey): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    new TextEncoder().encode(plain),
  );
  return {
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
  };
}

export async function decryptWithKey(blob: EncryptedBlob, key: CryptoKey): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(b64ToBytes(blob.iv)) },
      key,
      toBuffer(b64ToBytes(blob.ciphertext)),
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    if (error instanceof DecryptError) throw error;
    throw new DecryptError();
  }
}

export async function createVault(
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<VaultHeader> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(passphrase, salt, iterations);
  const verifier = await encryptWithKey(VAULT_CHECK, key);
  return { salt: bytesToB64(salt), iterations, verifier };
}

/** Derives the AES key and proves the passphrase against the stored verifier. */
export async function unlockKey(passphrase: string, header: VaultHeader): Promise<CryptoKey> {
  const key = await deriveAesKey(passphrase, b64ToBytes(header.salt), header.iterations);
  const check = await decryptWithKey(header.verifier, key);
  if (check !== VAULT_CHECK) throw new DecryptError();
  return key;
}
