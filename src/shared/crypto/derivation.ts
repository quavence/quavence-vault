import { HDKey } from '@scure/bip32';
import * as secp256k1 from '@noble/secp256k1';
import { NETWORK } from '../constants';
import { pubKeyToAddress, privKeyToWif } from './address';

export interface HDAccount {
  index: number;
  path: string;
  privKey: Uint8Array;
  pubKey: Uint8Array;
  address: string;
  wif: string;
}

/**
 * Derive an account at index from seed following BIP-44: m/44'/9999'/0'/0/index
 */
export function deriveAccountFromSeed(seed: Uint8Array, index = 0): HDAccount {
  const master = HDKey.fromMasterSeed(seed);
  const path = `${NETWORK.DERIVATION_PATH}/${index}`;
  const child = master.derive(path);

  if (!child.privateKey) {
    throw new Error(`Failed to derive private key for path ${path}`);
  }

  const privKey = child.privateKey;
  // Compressed secp256k1 public key (33 bytes)
  const pubKey = secp256k1.getPublicKey(privKey, true);
  const address = pubKeyToAddress(pubKey);
  const wif = privKeyToWif(privKey, true);

  return {
    index,
    path,
    privKey,
    pubKey,
    address,
    wif,
  };
}
