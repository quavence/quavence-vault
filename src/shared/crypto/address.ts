import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { NETWORK } from '../constants';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET[i]] = i;
}

/**
 * Standard Base58 Encode
 */
export function base58Encode(source: Uint8Array): string {
  if (source.length === 0) return '';
  const digits = [0];
  for (let i = 0; i < source.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += source[i];
    let carry = 0;
    for (let j = 0; j < digits.length; ++j) {
      digits[j] += carry;
      carry = (digits[j] / 58) | 0;
      digits[j] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let k = 0; source[k] === 0 && k < source.length - 1; k++) {
    digits.push(0);
  }
  return digits.reverse().map((digit) => ALPHABET[digit]).join('');
}

/**
 * Standard Base58 Decode
 */
export function base58Decode(string: string): Uint8Array {
  if (string.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    if (!(c in ALPHABET_MAP)) throw new Error(`Non-base58 character: ${c}`);
    for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
    bytes[0] += ALPHABET_MAP[c];
    let carry = 0;
    for (let j = 0; j < bytes.length; ++j) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; string[k] === '1' && k < string.length - 1; k++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

/**
 * Base58Check Encode: payload + 4 bytes double-SHA256 checksum
 */
export function base58CheckEncode(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const combined = new Uint8Array(payload.length + 4);
  combined.set(payload);
  combined.set(checksum, payload.length);
  return base58Encode(combined);
}

/**
 * Base58Check Decode with checksum validation
 */
export function base58CheckDecode(str: string): Uint8Array {
  const decoded = base58Decode(str);
  if (decoded.length < 4) throw new Error('Base58Check data too short');
  const payload = decoded.slice(0, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const expectedChecksum = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      throw new Error('Invalid Base58Check checksum');
    }
  }
  return payload;
}

/**
 * Decode Base58Check address to version byte and 20-byte pubkey hash
 */
export function decodeAddress(address: string): { version: number; hash160: Uint8Array } {
  const payload = base58CheckDecode(address);
  return {
    version: payload[0],
    hash160: payload.slice(1),
  };
}

/**
 * HASH160: RIPEMD160(SHA256(pubKey))
 */
export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

/**
 * Convert compressed public key (33 bytes) to native Quavence address ('S...').
 */
export function pubKeyToAddress(pubKey: Uint8Array, versionByte = NETWORK.PUBKEY_VERSION): string {
  const pkh = hash160(pubKey);
  const payload = new Uint8Array(1 + pkh.length);
  payload[0] = versionByte;
  payload.set(pkh, 1);
  return base58CheckEncode(payload);
}

/**
 * Convert 32-byte private key to WIF format for import into Quavence Core (quavence-qt importprivkey).
 * Uses compressed flag (0x01 suffix).
 */
export function privKeyToWif(privKey: Uint8Array, compressed = true, versionByte = NETWORK.WIF_VERSION): string {
  const len = 1 + privKey.length + (compressed ? 1 : 0);
  const payload = new Uint8Array(len);
  payload[0] = versionByte;
  payload.set(privKey, 1);
  if (compressed) {
    payload[len - 1] = 0x01;
  }
  return base58CheckEncode(payload);
}

/**
 * Decode WIF string back to 32-byte private key.
 */
export function wifToPrivKey(wif: string): { privKey: Uint8Array; compressed: boolean } {
  const payload = base58CheckDecode(wif);
  if (payload[0] !== NETWORK.WIF_VERSION) {
    throw new Error(`Invalid WIF version byte: ${payload[0]}`);
  }
  if (payload.length === 34 && payload[33] === 0x01) {
    return { privKey: payload.slice(1, 33), compressed: true };
  }
  if (payload.length === 33) {
    return { privKey: payload.slice(1, 33), compressed: false };
  }
  throw new Error('Invalid WIF payload length');
}

/**
 * Validate Quavence address format (must start with 'S' and have valid checksum).
 */
export function isValidAddress(address: string): boolean {
  try {
    const payload = base58CheckDecode(address.trim());
    return payload.length === 21 && payload[0] === NETWORK.PUBKEY_VERSION;
  } catch {
    return false;
  }
}
