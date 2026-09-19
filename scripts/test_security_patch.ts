import assert from 'node:assert';
import { handleExtensionMessage } from '../src/background/messageRouter';

// Mock chrome API for headless test
(globalThis as any).chrome = {
  runtime: {
    id: 'quavence-extension-mock-id',
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => ({}),
    },
    session: {
      get: async () => ({}),
      set: async () => ({}),
      remove: async () => ({}),
    },
  },
};

async function runSecurityTests() {
  console.log('🔒 Testing Quavence Vault Security Patch QV-2026-001...');

  // 1. Simulate external attack from webpage via content script (sender has tab)
  const externalSender: any = {
    id: 'quavence-extension-mock-id',
    tab: { id: 101, url: 'https://evil-attacker.com' },
    origin: 'https://evil-attacker.com',
    url: 'https://evil-attacker.com',
  };

  const maliciousSign = await handleExtensionMessage(
    {
      type: 'VAULT_SIGN_TRANSACTION',
      payload: { utxos: [], toAddress: 'S_ATTACKER', amountSat: 1000 },
    },
    externalSender
  );

  assert.strictEqual(maliciousSign.ok, false, 'External VAULT_SIGN_TRANSACTION must be blocked');
  assert(maliciousSign.error.includes('Forbidden'), 'Error must indicate Forbidden');
  console.log('  ✅ BLOCKED: External tab cannot invoke VAULT_SIGN_TRANSACTION');

  const maliciousGlyph = await handleExtensionMessage(
    {
      type: 'VAULT_SEND_GLYPH_L1',
      payload: {},
    },
    externalSender
  );
  assert.strictEqual(maliciousGlyph.ok, false, 'External VAULT_SEND_GLYPH_L1 must be blocked');
  console.log('  ✅ BLOCKED: External tab cannot invoke VAULT_SEND_GLYPH_L1');

  const maliciousApproval = await handleExtensionMessage(
    {
      type: 'APPROVAL_RESOLVE',
      payload: { id: 'test', result: true },
    },
    externalSender
  );
  assert.strictEqual(maliciousApproval.ok, false, 'External APPROVAL_RESOLVE must be blocked');
  console.log('  ✅ BLOCKED: External tab cannot invoke APPROVAL_RESOLVE');

  // 2. Simulate internal extension UI (popup / sidepanel: no tab, sender.id matches)
  const internalSender: any = {
    id: 'quavence-extension-mock-id',
    tab: undefined,
    origin: 'chrome-extension://quavence-extension-mock-id',
  };

  const internalCheck = await handleExtensionMessage(
    {
      type: 'VAULT_HAS_VAULT',
    },
    internalSender
  );
  assert.strictEqual(internalCheck.ok, true, 'Internal VAULT_HAS_VAULT must be permitted');
  assert.strictEqual(internalCheck.data, false, 'No vault initialized yet');
  console.log('  ✅ ALLOWED: Internal UI popup can invoke VAULT_HAS_VAULT');

  console.log('🎉 ALL SECURITY PATCH VERIFICATION TESTS PASSED!');
}

runSecurityTests().catch((err) => {
  console.error('❌ Security test failed:', err);
  process.exit(1);
});
