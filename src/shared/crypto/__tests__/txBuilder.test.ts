import { buildAndSignTransaction, UTXO } from '../txBuilder';
import { generateMnemonic, mnemonicToSeed } from '../mnemonic';
import { deriveAccountFromSeed } from '../derivation';

async function runTxBuilderTest() {
  console.log('🧪 Running Quavence txBuilder Engine Verification Suite...\n');

  // Derive test sender account
  const mnemonic = generateMnemonic(12);
  const seed = mnemonicToSeed(mnemonic);
  const sender = deriveAccountFromSeed(seed, 0);
  const recipient = 'SN6UdkEgxgXPv9ueZzEeVZ45XT44rxCbqY';

  console.log(`[1] Sender address: ${sender.address}`);
  console.log(`    Recipient address: ${recipient}`);

  // Mock spendable UTXOs
  const utxos: UTXO[] = [
    {
      txid: '68c882a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789a',
      vout_index: 0,
      amount: 100000000, // 1.00 QVNC in satoshis
    },
  ];

  // Target send: 0.25 QVNC
  const amountSat = 25000000; // 0.25 QVNC
  const feeSat = 10000; // 0.0001 QVNC

  const result = await buildAndSignTransaction({
    utxos,
    fromAddress: sender.address,
    toAddress: recipient,
    amountSat,
    feeSat,
    privKey: sender.privKey,
  });

  console.log('[2] Transaction built and signed locally:');
  console.log(`    Generated TXID: ${result.txid}`);
  console.log(`    Raw Hex Length: ${result.rawHex.length} chars (${result.rawHex.length / 2} bytes)`);
  console.log(`    Raw Hex: ${result.rawHex.slice(0, 64)}...`);

  if (!result.rawHex || result.rawHex.length < 200) {
    throw new Error('❌ Serialized raw transaction hex is too short!');
  }
  if (!result.txid || result.txid.length !== 64) {
    throw new Error('❌ Invalid TXID length!');
  }

  console.log('\n🎉 TXBUILDER UNIT TEST PASSED PERFECTLY!');
}

runTxBuilderTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
