import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { decodeAddress, pubKeyToAddress } from './address';
import { encodeVarInt } from './signing';

export interface UTXO {
  txid: string;
  vout_index: number;
  amount: number; // in satoshis
  block_height?: number;
  isCarrier?: boolean; // Protected PoUS AI Glyph carrier UTXO (locked from standard coin selection)
  glyphEdition?: number;
}

export interface TxOutput {
  address: string;
  amountSat: number; // in satoshis
}

export interface BuildTxParams {
  utxos: UTXO[];
  fromAddress: string;
  toAddress?: string;
  amountSat?: number;
  outputs?: TxOutput[];
  feeSat?: number;
  privKey: Uint8Array;
  excludeUtxos?: Array<{ txid: string; vout_index?: number }>; // Explicit exclusion of carrier / reserved UTXOs
}

export const GLYPH_DUST_SAT = 10_000; // 0.0001 QVNC — minimal UTXO carrying the glyph
export const GLYPH_OP_RETURN_PREFIX = 'QVNC';
export const GLYPH_PROTOCOL_VERSION = 0x01;

export type GlyphOpType = 0x01 | 0x02 | 0x03 | 0x04;
export const GLYPH_OP = {
  MINT: 0x01 as GlyphOpType,
  GENESIS: 0x02 as GlyphOpType,
  TRANSFER: 0x03 as GlyphOpType,
  BURN: 0x04 as GlyphOpType,
} as const;

export interface GlyphMeta {
  glyphId: string; // hex string, 32 bytes = SHA256 of svg_content / glyph_hash
  edition: number; // uint16
  opType: GlyphOpType;
  carrierTxid?: string;
  carrierVout?: number;
}

export interface BuildGlyphTxParams {
  utxos: UTXO[];
  fromAddress: string;
  toAddress: string;
  glyphMeta: GlyphMeta;
  feeSat?: number;
  dustSat?: number;
  privKey: Uint8Array;
}

const DEFAULT_MIN_FEE_SAT = 10000; // 0.0001 QVNC
const SIGHASH_ALL = 1;

/**
 * Double SHA256 helper
 */
function hash256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Reverse bytes in-place or return a new reversed copy
 */
function reverseBytes(bytes: Uint8Array): Uint8Array {
  const rev = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    rev[i] = bytes[bytes.length - 1 - i];
  }
  return rev;
}

/**
 * Encode P2PKH scriptPubKey from Base58 Quavence Address
 */
function addressToScriptPubKey(address: string): Uint8Array {
  const decoded = decodeAddress(address);
  const pubKeyHash = decoded.hash160; // 20 bytes

  // OP_DUP (0x76) OP_HASH160 (0xa9) 0x14 <pubKeyHash> OP_EQUALVERIFY (0x88) OP_CHECKSIG (0xac)
  const script = new Uint8Array(25);
  script[0] = 0x76;
  script[1] = 0xa9;
  script[2] = 0x14; // Push 20 bytes
  script.set(pubKeyHash, 3);
  script[23] = 0x88;
  script[24] = 0xac;
  return script;
}

/**
 * Serialize 32-bit integer Little-Endian
 */
function writeUint32LE(num: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, num, true);
  return buf;
}

/**
 * Serialize 64-bit integer Little-Endian (satoshis)
 */
function writeUint64LE(amountSat: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  const big = BigInt(Math.round(amountSat));
  view.setBigUint64(0, big, true);
  return buf;
}

/**
 * Combine multiple Uint8Arrays into one
 */
function concatBuffers(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Encode secp256k1 Signature into standard DER format with SIGHASH_ALL byte
 */
function toDerSignature(sig: secp256k1.Signature): Uint8Array {
  const rHex = sig.r.toString(16);
  const sHex = sig.s.toString(16);

  let rBytes = hexToBytes(rHex.length % 2 === 0 ? rHex : '0' + rHex);
  let sBytes = hexToBytes(sHex.length % 2 === 0 ? sHex : '0' + sHex);

  // If highest bit is set, prefix with 0x00 to ensure positive integer in DER
  if (rBytes[0] & 0x80) {
    const tmp = new Uint8Array(rBytes.length + 1);
    tmp.set(rBytes, 1);
    rBytes = tmp;
  }
  if (sBytes[0] & 0x80) {
    const tmp = new Uint8Array(sBytes.length + 1);
    tmp.set(sBytes, 1);
    sBytes = tmp;
  }

  const derLen = 4 + rBytes.length + sBytes.length;
  const der = new Uint8Array(derLen + 2);
  der[0] = 0x30; // Sequence tag
  der[1] = derLen;
  der[2] = 0x02; // Integer tag for r
  der[3] = rBytes.length;
  der.set(rBytes, 4);

  const sOffset = 4 + rBytes.length;
  der[sOffset] = 0x02; // Integer tag for s
  der[sOffset + 1] = sBytes.length;
  der.set(sBytes, sOffset + 2);

  // Append SIGHASH_ALL (0x01)
  const fullSig = new Uint8Array(der.length + 1);
  fullSig.set(der, 0);
  fullSig[der.length] = SIGHASH_ALL;
  return fullSig;
}

/**
 * Build and sign a native Quavence P2PKH UTXO transaction purely on client.
 */
export async function buildAndSignTransaction(params: BuildTxParams): Promise<{ rawHex: string; txid: string; feeSat: number }> {
  const { utxos, fromAddress, privKey } = params;
  const feeSat = params.feeSat ?? DEFAULT_MIN_FEE_SAT;

  let targetOutputs: TxOutput[] = [];
  if (Array.isArray(params.outputs) && params.outputs.length > 0) {
    targetOutputs = params.outputs.filter((o) => o.amountSat > 0);
  } else if (params.toAddress && params.amountSat && params.amountSat > 0) {
    targetOutputs = [{ address: params.toAddress, amountSat: params.amountSat }];
  } else {
    throw new Error('Transaction must have at least one recipient output with positive amount');
  }

  const amountSat = targetOutputs.reduce((sum, o) => sum + o.amountSat, 0);
  const targetTotal = amountSat + feeSat;

  // 1. Coin Selection with PoUS AI Glyph Carrier Immunity:
  // Carrier UTXOs (dust of 10,000 sat carrying a Glyph inscription) must NEVER be automatically
  // selected for standard payments or fee payment, preventing accidental burning or loss of NFTs.
  const excludeKeys = new Set<string>();
  if (Array.isArray(params.excludeUtxos)) {
    params.excludeUtxos.forEach((ex) => {
      if (typeof ex.vout_index === 'number') {
        excludeKeys.add(`${ex.txid}:${ex.vout_index}`);
      } else {
        excludeKeys.add(ex.txid);
      }
    });
  }

  let selectedInputs: UTXO[] = [];
  let accumulatedSat = 0;
  let skippedCarrierCount = 0;

  for (const u of utxos) {
    if (u.amount <= 0) continue;

    // Strict carrier check: explicit exclusion or marked as carrier
    const isExcluded = excludeKeys.has(`${u.txid}:${u.vout_index}`) || excludeKeys.has(u.txid);
    if (u.isCarrier || isExcluded) {
      skippedCarrierCount++;
      continue;
    }

    selectedInputs.push(u);
    accumulatedSat += u.amount;
    if (accumulatedSat >= targetTotal) {
      break;
    }
  }

  if (accumulatedSat < targetTotal) {
    const carrierNote =
      skippedCarrierCount > 0
        ? ` (${skippedCarrierCount} carrier UTXO${skippedCarrierCount > 1 ? 's' : ''} locked to protect on-chain PoUS AI Glyphs)`
        : '';
    throw new Error(
      `Insufficient spendable UTXOs. Required: ${targetTotal / 1e8} QVNC (including ${feeSat / 1e8} fee), Available: ${accumulatedSat / 1e8} QVNC${carrierNote}`
    );
  }

  // 2. Prepare Outputs
  const outputs: TxOutput[] = [...targetOutputs];

  const changeSat = accumulatedSat - targetTotal;
  // If change is greater than dust threshold (e.g. 1000 sat), return change to sender
  if (changeSat >= 1000) {
    outputs.push({ address: fromAddress, amountSat: changeSat });
  }

  // 3. Serialize Pre-image and Sign Each Input
  const versionBytes = writeUint32LE(1);
  // POS/Blackcoin style: timestamp in tx header
  const timeBytes = writeUint32LE(Math.floor(Date.now() / 1000));
  const locktimeBytes = writeUint32LE(0);
  const sequenceBytes = hexToBytes('ffffffff');

  const fromScriptPubKey = addressToScriptPubKey(fromAddress);
  const pubKey = secp256k1.getPublicKey(privKey, true); // compressed 33-byte pubkey

  // Helper to serialize inputs for digest calculation
  const getPreimage = (signingInputIndex: number): Uint8Array => {
    const vinBuffers: Uint8Array[] = [encodeVarInt(selectedInputs.length)];

    selectedInputs.forEach((inp, idx) => {
      // Prev txid is in reversed byte order (RPC display is reverse of wire protocol)
      const prevTxidBytes = reverseBytes(hexToBytes(inp.txid));
      const prevVoutBytes = writeUint32LE(inp.vout_index);

      let scriptBytes = new Uint8Array(0);
      if (idx === signingInputIndex) {
        scriptBytes = new Uint8Array(fromScriptPubKey);
      }

      vinBuffers.push(
        prevTxidBytes,
        prevVoutBytes,
        encodeVarInt(scriptBytes.length),
        scriptBytes,
        sequenceBytes
      );
    });

    const voutBuffers: Uint8Array[] = [encodeVarInt(outputs.length)];
    outputs.forEach((out) => {
      const outScript = addressToScriptPubKey(out.address);
      voutBuffers.push(
        writeUint64LE(out.amountSat),
        encodeVarInt(outScript.length),
        outScript
      );
    });

    const hashTypeBytes = writeUint32LE(SIGHASH_ALL);

    return concatBuffers(
      versionBytes,
      timeBytes,
      ...vinBuffers,
      ...voutBuffers,
      locktimeBytes,
      hashTypeBytes
    );
  };

  // Sign each input
  const signedScriptSigs: Uint8Array[] = [];

  for (let i = 0; i < selectedInputs.length; i++) {
    const preimage = getPreimage(i);
    const digest = hash256(preimage);

    const sig = await secp256k1.sign(digest, privKey, { lowS: true });
    const derSig = toDerSignature(sig);

    // scriptSig = PUSH(derSig) + PUSH(pubKey)
    const scriptSig = concatBuffers(
      encodeVarInt(derSig.length),
      derSig,
      encodeVarInt(pubKey.length),
      pubKey
    );

    signedScriptSigs.push(scriptSig);
  }

  // 4. Assemble Final Wire Transaction
  const finalVinBuffers: Uint8Array[] = [encodeVarInt(selectedInputs.length)];
  selectedInputs.forEach((inp, idx) => {
    const prevTxidBytes = reverseBytes(hexToBytes(inp.txid));
    const prevVoutBytes = writeUint32LE(inp.vout_index);
    const scriptSig = signedScriptSigs[idx];

    finalVinBuffers.push(
      prevTxidBytes,
      prevVoutBytes,
      encodeVarInt(scriptSig.length),
      scriptSig,
      sequenceBytes
    );
  });

  const finalVoutBuffers: Uint8Array[] = [encodeVarInt(outputs.length)];
  outputs.forEach((out) => {
    const outScript = addressToScriptPubKey(out.address);
    finalVoutBuffers.push(
      writeUint64LE(out.amountSat),
      encodeVarInt(outScript.length),
      outScript
    );
  });

  const finalTxBytes = concatBuffers(
    versionBytes,
    timeBytes,
    ...finalVinBuffers,
    ...finalVoutBuffers,
    locktimeBytes
  );

  const rawHex = bytesToHex(finalTxBytes);
  // Transaction ID is double-sha256 of wire tx, displayed in reversed byte order
  const txidBytes = hash256(finalTxBytes);
  const txid = bytesToHex(reverseBytes(new Uint8Array(txidBytes)));

  return {
    rawHex,
    txid,
    feeSat,
  };
}

/**
 * Encode glyph metadata into compact OP_RETURN payload (40 bytes max).
 * Layout: "QVNC"(4) | version(1) | op_type(1) | glyph_id(32) | edition_le(2)
 */
export function encodeGlyphOpReturn(meta: GlyphMeta): Uint8Array {
  const buf = new Uint8Array(40);
  // Magic "QVNC"
  buf[0] = 0x51;
  buf[1] = 0x56;
  buf[2] = 0x4e;
  buf[3] = 0x43;
  buf[4] = GLYPH_PROTOCOL_VERSION;
  buf[5] = meta.opType;

  // glyph_id (32 bytes hex -> bytes)
  const cleanId = (meta.glyphId || '').replace(/^0x/, '').padStart(64, '0');
  const idBytes = hexToBytes(cleanId);
  buf.set(idBytes.slice(0, 32), 6);

  // edition uint16 LE
  const view = new DataView(buf.buffer);
  view.setUint16(38, meta.edition || 0, true);
  return buf;
}

/**
 * Build OP_RETURN scriptPubKey:
 * OP_RETURN (0x6a) | PUSH<len> | <payload>
 */
export function buildOpReturnScript(payload: Uint8Array): Uint8Array {
  const script = new Uint8Array(2 + payload.length);
  script[0] = 0x6a; // OP_RETURN
  script[1] = payload.length; // direct push for <= 75 bytes
  script.set(payload, 2);
  return script;
}

/**
 * Build and sign a native Quavence L1 Glyph transaction with OP_RETURN protocol payload.
 *
 * Wire Outputs:
 *   [0] P2PKH(toAddress)   - Carrier UTXO carrying GLYPH_DUST_SAT (10000 sat = 0.0001 QVNC)
 *   [1] OP_RETURN(payload) - 40 bytes protocol anchor (0 satoshis)
 *   [2] P2PKH(fromAddress) - Change output (if remaining balance >= 1000 satoshis)
 */
export async function buildAndSignGlyphTx(params: BuildGlyphTxParams): Promise<{
  rawHex: string;
  txid: string;
  feeSat: number;
  opReturnHex: string;
}> {
  const { utxos, fromAddress, toAddress, glyphMeta, privKey } = params;
  const feeSat = params.feeSat ?? DEFAULT_MIN_FEE_SAT;
  const dustSat = params.dustSat ?? GLYPH_DUST_SAT;

  const targetTotal = dustSat + feeSat;

  // 1. Coin Selection (prioritizing the carrier UTXO if specified)
  let selectedInputs: UTXO[] = [];
  let accumulatedSat = 0;

  const candidateUtxos = [...utxos];
  const requiresCarrier = glyphMeta.opType === GLYPH_OP.TRANSFER || glyphMeta.opType === GLYPH_OP.BURN;

  if (glyphMeta.carrierTxid || requiresCarrier) {
    if (!glyphMeta.carrierTxid) {
      throw new Error(
        `Carrier UTXO txid is strictly required for glyph ${glyphMeta.opType === GLYPH_OP.BURN ? 'BURN' : 'TRANSFER'}`
      );
    }

    const carrierIdx = candidateUtxos.findIndex((u) => {
      const matchTx = u.txid === glyphMeta.carrierTxid;
      const matchVout = glyphMeta.carrierVout === undefined || u.vout_index === glyphMeta.carrierVout;
      return matchTx && matchVout;
    });

    if (carrierIdx === -1) {
      throw new Error(
        `Carrier UTXO ${glyphMeta.carrierTxid}:${glyphMeta.carrierVout ?? 0} not found in spendable wallet UTXOs. Cannot build valid lineage-preserving transaction.`
      );
    }

    const [carrier] = candidateUtxos.splice(carrierIdx, 1);
    selectedInputs.push(carrier);
    accumulatedSat += carrier.amount;
  }

  // Gather additional funds for miner fee while strictly preserving any OTHER carrier UTXOs
  for (const u of candidateUtxos) {
    if (accumulatedSat >= targetTotal) break;
    if (u.amount <= 0 || u.isCarrier) continue;
    selectedInputs.push(u);
    accumulatedSat += u.amount;
  }

  if (accumulatedSat < targetTotal) {
    throw new Error(
      `Insufficient spendable UTXOs for L1 glyph transfer. Required: ${targetTotal / 1e8} QVNC (includes ${feeSat / 1e8} fee and ${dustSat / 1e8} glyph dust), Available: ${accumulatedSat / 1e8} QVNC`
    );
  }

  // 2. Prepare Outputs with OP_RETURN
  interface WireOutput {
    amountSat: number;
    scriptPubKey: Uint8Array;
  }

  const opReturnPayload = encodeGlyphOpReturn(glyphMeta);
  const opReturnScript = buildOpReturnScript(opReturnPayload);
  const opReturnHex = bytesToHex(opReturnPayload);

  const outputs: WireOutput[] = [
    // Output 0: Glyph bearer to recipient
    {
      amountSat: dustSat,
      scriptPubKey: addressToScriptPubKey(toAddress),
    },
    // Output 1: OP_RETURN anchor
    {
      amountSat: 0,
      scriptPubKey: opReturnScript,
    },
  ];

  const changeSat = accumulatedSat - targetTotal;
  // Output 2: Change back to sender (if above threshold)
  if (changeSat >= 1000) {
    outputs.push({
      amountSat: changeSat,
      scriptPubKey: addressToScriptPubKey(fromAddress),
    });
  }

  // 3. Serialize Pre-image and Sign Each Input
  const versionBytes = writeUint32LE(1);
  const timeBytes = writeUint32LE(Math.floor(Date.now() / 1000));
  const locktimeBytes = writeUint32LE(0);
  const sequenceBytes = hexToBytes('ffffffff');

  const fromScriptPubKey = addressToScriptPubKey(fromAddress);
  const pubKey = secp256k1.getPublicKey(privKey, true); // compressed 33-byte pubkey

  const getPreimage = (signingInputIndex: number): Uint8Array => {
    const vinBuffers: Uint8Array[] = [encodeVarInt(selectedInputs.length)];

    selectedInputs.forEach((inp, idx) => {
      const prevTxidBytes = reverseBytes(hexToBytes(inp.txid));
      const prevVoutBytes = writeUint32LE(inp.vout_index);

      let scriptBytes = new Uint8Array(0);
      if (idx === signingInputIndex) {
        scriptBytes = new Uint8Array(fromScriptPubKey);
      }

      vinBuffers.push(
        prevTxidBytes,
        prevVoutBytes,
        encodeVarInt(scriptBytes.length),
        scriptBytes,
        sequenceBytes
      );
    });

    const voutBuffers: Uint8Array[] = [encodeVarInt(outputs.length)];
    outputs.forEach((out) => {
      voutBuffers.push(
        writeUint64LE(out.amountSat),
        encodeVarInt(out.scriptPubKey.length),
        out.scriptPubKey
      );
    });

    const hashTypeBytes = writeUint32LE(SIGHASH_ALL);

    return concatBuffers(
      versionBytes,
      timeBytes,
      ...vinBuffers,
      ...voutBuffers,
      locktimeBytes,
      hashTypeBytes
    );
  };

  // Sign each input
  const signedScriptSigs: Uint8Array[] = [];

  for (let i = 0; i < selectedInputs.length; i++) {
    const preimage = getPreimage(i);
    const digest = hash256(preimage);

    const sig = await secp256k1.sign(digest, privKey, { lowS: true });
    const derSig = toDerSignature(sig);

    const scriptSig = concatBuffers(
      encodeVarInt(derSig.length),
      derSig,
      encodeVarInt(pubKey.length),
      pubKey
    );

    signedScriptSigs.push(scriptSig);
  }

  // 4. Assemble Final Wire Transaction
  const finalVinBuffers: Uint8Array[] = [encodeVarInt(selectedInputs.length)];
  selectedInputs.forEach((inp, idx) => {
    const prevTxidBytes = reverseBytes(hexToBytes(inp.txid));
    const prevVoutBytes = writeUint32LE(inp.vout_index);
    const scriptSig = signedScriptSigs[idx];

    finalVinBuffers.push(
      prevTxidBytes,
      prevVoutBytes,
      encodeVarInt(scriptSig.length),
      scriptSig,
      sequenceBytes
    );
  });

  const finalVoutBuffers: Uint8Array[] = [encodeVarInt(outputs.length)];
  outputs.forEach((out) => {
    finalVoutBuffers.push(
      writeUint64LE(out.amountSat),
      encodeVarInt(out.scriptPubKey.length),
      out.scriptPubKey
    );
  });

  const finalTxBytes = concatBuffers(
    versionBytes,
    timeBytes,
    ...finalVinBuffers,
    ...finalVoutBuffers,
    locktimeBytes
  );

  const rawHex = bytesToHex(finalTxBytes);
  const txidBytes = hash256(finalTxBytes);
  const txid = bytesToHex(reverseBytes(new Uint8Array(txidBytes)));

  return {
    rawHex,
    txid,
    feeSat,
    opReturnHex,
  };
}

