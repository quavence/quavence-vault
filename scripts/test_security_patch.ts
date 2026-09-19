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

  // 2. Simulate internal extension UI (popup / sidepanel)
  const trustedPopupSender: any = {
    id: 'quavence-extension-mock-id',
    tab: undefined,
    origin: 'chrome-extension://quavence-extension-mock-id',
    url: 'chrome-extension://quavence-extension-mock-id/popup.html?foo=1',
  };

  const internalCheck = await handleExtensionMessage(
    {
      type: 'VAULT_HAS_VAULT',
    },
    trustedPopupSender
  );
  assert.strictEqual(internalCheck.ok, true, 'Internal VAULT_HAS_VAULT must be permitted from popup');
  assert.strictEqual(internalCheck.data, false, 'No vault initialized yet');
  console.log('  ✅ ALLOWED: Trusted popup URL can invoke VAULT_HAS_VAULT');

  const trustedSidepanelSender: any = {
    id: 'quavence-extension-mock-id',
    tab: undefined,
    origin: 'chrome-extension://quavence-extension-mock-id',
    url: 'chrome-extension://quavence-extension-mock-id/sidepanel.html',
  };
  const sidepanelCheck = await handleExtensionMessage(
    {
      type: 'VAULT_HAS_VAULT',
    },
    trustedSidepanelSender
  );
  assert.strictEqual(sidepanelCheck.ok, true, 'Internal VAULT_HAS_VAULT must be permitted from sidepanel');
  console.log('  ✅ ALLOWED: Trusted sidepanel URL can invoke VAULT_HAS_VAULT');

  // 3. Test untrusted extension URL / undefined URL without popup/sidepanel
  const untrustedExtSender: any = {
    id: 'quavence-extension-mock-id',
    tab: undefined,
    origin: 'chrome-extension://quavence-extension-mock-id',
    url: 'chrome-extension://quavence-extension-mock-id/untrusted.html',
  };
  const untrustedCheck = await handleExtensionMessage(
    {
      type: 'VAULT_SIGN_TRANSACTION',
      payload: {},
    },
    untrustedExtSender
  );
  assert.strictEqual(untrustedCheck.ok, false, 'Untrusted extension page must be blocked');
  console.log('  ✅ BLOCKED: Untrusted internal extension page cannot invoke VAULT_SIGN_TRANSACTION');

  const noUrlSender: any = {
    id: 'quavence-extension-mock-id',
    tab: undefined,
  };
  const noUrlCheck = await handleExtensionMessage(
    {
      type: 'VAULT_SIGN_TRANSACTION',
      payload: {},
    },
    noUrlSender
  );
  assert.strictEqual(noUrlCheck.ok, false, 'Sender with no URL must be blocked');
  console.log('  ✅ BLOCKED: Sender without trusted page URL cannot invoke VAULT_SIGN_TRANSACTION');

  console.log('🎉 ALL SECURITY PATCH VERIFICATION TESTS PASSED!');
}

runSecurityTests().catch((err) => {
  console.error('❌ Security test failed:', err);
  process.exit(1);
});
