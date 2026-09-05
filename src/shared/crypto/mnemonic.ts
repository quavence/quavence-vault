import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Generate a new random BIP-39 mnemonic phrase.
 * @param strength 128 bits for 12 words, 256 bits for 24 words. Default 128 (12 words).
 */
export function generateMnemonic(wordsOrStrength: 12 | 24 | 128 | 256 = 12): string {
  const strength = wordsOrStrength === 12 ? 128 : wordsOrStrength === 24 ? 256 : wordsOrStrength;
  return bip39.generateMnemonic(wordlist, strength);
}

/**
 * Validate whether the provided mnemonic phrase has valid checksum and wordlist.
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim(), wordlist);
}

/**
 * Convert a mnemonic phrase to a binary seed (64 bytes) with optional passphrase.
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  return bip39.mnemonicToSeedSync(mnemonic.trim(), passphrase);
}
