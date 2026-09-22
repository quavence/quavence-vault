/**
 * Audit 4 — Vault Extension Carrier UTXO Selection & Failure Semantics
 *
 * Verifies:
 * 1. PUB-02: Does buildAndSignGlyphTx fail loudly if the requested carrier UTXO is not found?
 * 2. Proper carrierVout matching when carrier is at non-zero vout (e.g. vout = 1).
 */
import { buildAndSignGlyphTx, GLYPH_OP, UTXO } from '../src/shared/crypto/txBuilder';
import { generateMnemonic, mnemonicToSeed } from '../src/shared/crypto/mnemonic';
import { deriveAccountFromSeed } from '../src/shared/crypto/derivation';

async function runAudit4VaultTests() {
  console.log('================================================================');
  console.log('=== AUDIT 4: VAULT EXTENSION CARRIER INTEGRITY SUITE         ===');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      if (detail) console.error(`       Detail: ${detail}`);
      failed++;
    }
  }

  const mnemonic = generateMnemonic(12);
  const seed = mnemonicToSeed(mnemonic);
  const sender = deriveAccountFromSeed(seed, 0);
  const recipient = 'SN6UdkEgxgXPv9ueZzEeVZ45XT44rxCbqY';
  const dummyHash = '22'.repeat(32);

  const realCarrierTxid = '8888888888888888888888888888888888888888888888888888888888888888';
  const standardFundingTxid = '9999999999999999999999999999999999999999999999999999999999999999';

  // --------------------------------------------------------------------------
  // TEST 1: Matching carrier at vout = 1
  // --------------------------------------------------------------------------
  console.log('--- 1. Testing Carrier Selection at vout = 1 ---');
  const utxosWithVout1: UTXO[] = [
    {
      txid: realCarrierTxid,
      vout_index: 1, // Carrier is at output index 1!
      amount: 10000,
      isCarrier: true,
    },
    {
      txid: standardFundingTxid,
      vout_index: 0,
      amount: 50000000, // 0.50 QVNC to cover miner fee
      isCarrier: false,
    },
  ];

  try {
    const res = await buildAndSignGlyphTx({
      utxos: utxosWithVout1,
      fromAddress: sender.address,
      toAddress: recipient,
      glyphMeta: {
        glyphId: dummyHash,
        edition: 42,
        opType: GLYPH_OP.TRANSFER,
        carrierTxid: realCarrierTxid,
        carrierVout: 1,
      },
      privKey: sender.privKey,
    });

    // Check that realCarrierTxid in reverse byte order is in the raw hex inputs
    // In Bitcoin wire format, txid 8888... is reversed (all 88s is still all 88s)
    const spendsCarrier = res.rawHex.includes('88'.repeat(32));
    assert(spendsCarrier, 'Correctly selected carrier at vout = 1 as input');
  } catch (err: any) {
    assert(false, 'Correctly selected carrier at vout = 1 as input', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Missing / Mismatched Carrier UTXO MUST Fail Loudly (Zero Mocks / Fail Loudly)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Missing Carrier UTXO Rejection (Fail Loudly) ---');
  // Scenario: DApp / UI sends carrierVout = 0 (because /api/glyphs omitted carrierVout),
  // but the wallet only has the carrier at vout = 1!
  // Or the carrier UTXO was spent or not present in wallet at all.
  const utxosMissingExpectedVout: UTXO[] = [
    {
      txid: realCarrierTxid,
      vout_index: 1, // Only vout 1 exists
      amount: 10000,
      isCarrier: true,
    },
    {
      txid: standardFundingTxid,
      vout_index: 0,
      amount: 50000000, // 0.50 QVNC standard funding
      isCarrier: false,
    },
  ];

  let threwExpectedError = false;
  let producedBogusTx = false;

  try {
    const bogusRes = await buildAndSignGlyphTx({
      utxos: utxosMissingExpectedVout,
      fromAddress: sender.address,
      toAddress: recipient,
      glyphMeta: {
        glyphId: dummyHash,
        edition: 42,
        opType: GLYPH_OP.TRANSFER,
        carrierTxid: realCarrierTxid,
        carrierVout: 0, // Mismatched vout (expected 0, but only 1 exists)
      },
      privKey: sender.privKey,
    });

    // If it didn't throw, it silently proceeded!
    producedBogusTx = true;
    console.error(`[SILENT FAILURE DETECTED] buildAndSignGlyphTx returned a signed tx (${bogusRes.txid}) despite carrier not matching!`);
  } catch (err: any) {
    if (err.message.includes('carrier') || err.message.includes('Carrier')) {
      threwExpectedError = true;
    } else {
      console.log(`Threw other error: ${err.message}`);
    }
  }

  assert(
    threwExpectedError && !producedBogusTx,
    'Rejects transfer when specified carrier UTXO is not matched in wallet (Fail Loudly)',
    'Function silently fell through and minted an invalid counterfeit transfer without carrier input!'
  );

  console.log('\n================================================================');
  console.log(`=== AUDIT 4 VAULT RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit4VaultTests().catch((err) => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
