import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '../mnemonic';
import { deriveAccountFromSeed } from '../derivation';
import { isValidAddress, privKeyToWif, wifToPrivKey } from '../address';
import { signMessage, verifyMessage } from '../signing';

async function runCryptoTestSuite() {
  console.log('🧪 Running Quavence Crypto Engine Verification Suite...\n');

  // 1. Mnemonic Generation & Validation
  const mnemonic = generateMnemonic(12);
  console.log(`[1] Generated Mnemonic (12 words): "${mnemonic}"`);
  if (!validateMnemonic(mnemonic)) {
    throw new Error('❌ Generated mnemonic failed validation!');
  }
  console.log('    ✅ Mnemonic is valid BIP-39 phrase.');

  // 2. Seed & BIP-44 Derivation
  const seed = mnemonicToSeed(mnemonic);
  console.log(`[2] Seed derived: length = ${seed.length} bytes`);

  const account = deriveAccountFromSeed(seed, 0);
  console.log(`[3] Account 0 derived via path: ${account.path}`);
  console.log(`    Address: ${account.address}`);
  console.log(`    WIF PrivKey: ${account.wif}`);

  // 3. Address prefix check
  if (!account.address.startsWith('S')) {
    throw new Error(`❌ Address does NOT start with 'S'! Got: ${account.address}`);
  }
  console.log('    ✅ Address correctly starts with "S" (PUBKEY_VERSION 0x3F / 63).');

  if (!isValidAddress(account.address)) {
    throw new Error(`❌ isValidAddress returned false for ${account.address}`);
  }
  console.log('    ✅ Base58Check checksum and length verified.');

  // 4. WIF Round-trip check
  const decodedWif = wifToPrivKey(account.wif);
  const wifHex = Array.from(decodedWif.privKey).map((b) => b.toString(16).padStart(2, '0')).join('');
  const privHex = Array.from(account.privKey).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (wifHex !== privHex) {
    throw new Error('❌ WIF decode mismatch!');
  }
  console.log('    ✅ WIF private key encodes and decodes losslessly (compatible with Core importprivkey).');

  // 5. Message Signing with BlackCoin prefix
  const testMessage = 'Quavence PoUS Verification Nonce: 8829471';
  console.log(`[4] Signing message: "${testMessage}"`);
  const signature = await signMessage(testMessage, account.privKey);
  console.log(`    Signature (Base64): ${signature}`);

  const isValid = verifyMessage(testMessage, signature, account.address);
  if (!isValid) {
    throw new Error('❌ Signature verification failed!');
  }
  console.log('    ✅ Signature correctly verified and recovered to expected "S..." address!');

  console.log('\n🎉 ALL CRYPTO TESTS PASSED PERFECTLY!');
}

runCryptoTestSuite().catch((err) => {
  console.error('\n🚨 TEST SUITE FAILED:', err);
  process.exit(1);
});
