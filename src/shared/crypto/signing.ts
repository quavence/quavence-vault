import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { NETWORK } from '../constants';
import { pubKeyToAddress } from './address';

// Configure noble/secp256k1 v2 HMAC-SHA256 implementation (both sync and async)
secp256k1.etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]) =>
  hmac(sha256, k, secp256k1.etc.concatBytes(...m));
secp256k1.etc.hmacSha256Async = (k: Uint8Array, ...m: Uint8Array[]) =>
  Promise.resolve(hmac(sha256, k, secp256k1.etc.concatBytes(...m)));

/**
 * Encode number as Bitcoin-style CompactSize (varint)
 */
export function encodeVarInt(num: number): Uint8Array {
  if (num < 0xfd) {
    return new Uint8Array([num]);
  } else if (num <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = num & 0xff;
    buf[2] = (num >> 8) & 0xff;
    return buf;
  } else if (num <= 0xffffffff) {
    const buf = new Uint8Array(5);
    buf[0] = 0xfe;
    buf[1] = num & 0xff;
    buf[2] = (num >> 8) & 0xff;
    buf[3] = (num >> 16) & 0xff;
    buf[4] = (num >> 24) & 0xff;
    return buf;
  } else {
    throw new Error('Number too large for CompactSize in message signing');
  }
}

/**
 * Compute the double-SHA256 hash of a message prefixed with BlackCoin magic header.
 * Equivalent to:
 * SHA256(SHA256( varint(len(magic)) + magic + varint(len(msg)) + msg ))
 */
export function hashMessage(message: string, magic = NETWORK.SIGN_MAGIC): Uint8Array {
  const enc = new TextEncoder();
  const magicBytes = enc.encode(magic);
  const msgBytes = enc.encode(message);

  const magicLen = encodeVarInt(magicBytes.length);
  const msgLen = encodeVarInt(msgBytes.length);

  const totalLen = magicLen.length + magicBytes.length + msgLen.length + msgBytes.length;
  const buffer = new Uint8Array(totalLen);

  let offset = 0;
  buffer.set(magicLen, offset);
  offset += magicLen.length;

  buffer.set(magicBytes, offset);
  offset += magicBytes.length;

  buffer.set(msgLen, offset);
  offset += msgLen.length;

  buffer.set(msgBytes, offset);

  return sha256(sha256(buffer));
}

/**
 * Sign a message using Bitcoin/BlackCoin standard format.
 * Returns base64-encoded 65-byte signature compatible with `quavence-cli verifymessage`.
 */
export async function signMessage(message: string, privKey: Uint8Array): Promise<string> {
  const hash = hashMessage(message);

  // Sign with extra options to get recovery flag and enforce lowS (BIP62/RFC6979)
  const sig = await secp256k1.sign(hash, privKey, { lowS: true });
  const recovery = sig.recovery;

  if (typeof recovery !== 'number') {
    throw new Error('Failed to obtain signature recovery parameter');
  }

  // Header byte: 27 + recovery + (compressed ? 4 : 0)
  // Quavence uses compressed keys -> 27 + recovery + 4 = 31 + recovery
  const headerByte = 31 + recovery;

  const fullSig = new Uint8Array(65);
  fullSig[0] = headerByte;

  // Convert r and s to 32-byte big-endian arrays
  const rBytes = new Uint8Array(32);
  const sBytes = new Uint8Array(32);

  const rHex = sig.r.toString(16).padStart(64, '0');
  const sHex = sig.s.toString(16).padStart(64, '0');

  for (let i = 0; i < 32; i++) {
    rBytes[i] = parseInt(rHex.substring(i * 2, i * 2 + 2), 16);
    sBytes[i] = parseInt(sHex.substring(i * 2, i * 2 + 2), 16);
  }

  fullSig.set(rBytes, 1);
  fullSig.set(sBytes, 33);

  // Convert to Base64
  let binary = '';
  for (let i = 0; i < fullSig.length; i++) {
    binary += String.fromCharCode(fullSig[i]);
  }
  return btoa(binary);
}

/**
 * Verify a message signature locally.
 */
export function verifyMessage(message: string, signatureBase64: string, expectedAddress: string): boolean {
  try {
    const binary = atob(signatureBase64);
    const sigBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      sigBytes[i] = binary.charCodeAt(i);
    }

    if (sigBytes.length !== 65) return false;

    const header = sigBytes[0];
    if (header < 27 || header > 34) return false;

    const compressed = header >= 31;
    const recovery = compressed ? header - 31 : header - 27;

    const rHex = Array.from(sigBytes.slice(1, 33)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const sHex = Array.from(sigBytes.slice(33, 65)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const sig = new secp256k1.Signature(BigInt(`0x${rHex}`), BigInt(`0x${sHex}`));
    const sigWithRecovery = sig.addRecoveryBit(recovery);

    const hash = hashMessage(message);
    const recoveredPoint = sigWithRecovery.recoverPublicKey(hash);
    const pubKey = recoveredPoint.toRawBytes(compressed);
    const recoveredAddress = pubKeyToAddress(pubKey);

    return recoveredAddress === expectedAddress;
  } catch {
    return false;
  }
}
