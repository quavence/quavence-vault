import { VAULT_SECURITY } from '../shared/constants';

export interface EncryptedVault {
  ciphertextHex: string;
  saltHex: string;
  ivHex: string;
  version: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Derive AES-GCM 256-bit encryption key from password and salt using PBKDF2.
 */
async function deriveEncryptionKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: VAULT_SECURITY.PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a mnemonic phrase using AES-GCM-256 and PBKDF2.
 */
export async function encryptMnemonic(mnemonic: string, password: string): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveEncryptionKey(password, salt);
  const enc = new TextEncoder();
  const plaintext = enc.encode(mnemonic.trim());

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource
  );

  return {
    ciphertextHex: bytesToHex(new Uint8Array(ciphertextBuffer)),
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    version: 1,
  };
}

/**
 * Decrypt an EncryptedVault back to plaintext mnemonic using the provided password.
 * Throws if the password is incorrect or ciphertext is tampered.
 */
export async function decryptMnemonic(vault: EncryptedVault, password: string): Promise<string> {
  const salt = hexToBytes(vault.saltHex);
  const iv = hexToBytes(vault.ivHex);
  const ciphertext = hexToBytes(vault.ciphertextHex);

  const key = await deriveEncryptionKey(password, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );
    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch {
    throw new Error('Incorrect password or corrupted vault data');
  }
}
