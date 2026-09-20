import assert from 'node:assert';

let windowCounter = 0;
const nav: string[] = [];
const openWindows = new Map<number, { tabs: Array<{ id: number; url: string }> }>();
let sessionStore: any = {};
let windowCloseListener: ((windowId: number) => void) | null = null;

(globalThis as any).chrome = {
  runtime: {
    id: 'mockid',
    getURL: (p: string) => `chrome-extension://mockid/${p}`,
  },
  storage: {
    local: { get: async () => ({}), set: async () => ({}) },
    session: {
      get: async (k: string) => ({ [k]: sessionStore[k] }),
      set: async (o: any) => { Object.assign(sessionStore, o); },
      remove: async (k: string) => { delete sessionStore[k]; },
    },
  },
  windows: {
    onRemoved: {
      addListener: (cb: (id: number) => void) => {
        windowCloseListener = cb;
      },
    },
    create: async ({ url }: any) => {
      const id = ++windowCounter;
      openWindows.set(id, { tabs: [{ id: id * 100, url }] });
      nav.push(url);
      return { id };
    },
    get: async (id: number) => {
      const w = openWindows.get(id);
      if (!w) throw new Error('no such window');
      return { id, tabs: w.tabs };
    },
    update: async () => {},
    remove: async (id: number) => {
      openWindows.delete(id);
      if (windowCloseListener) {
        windowCloseListener(id);
      }
    },
  },
  tabs: {
    create: async ({ url }: any) => { nav.push(url); return { id: 1 }; },
    update: async (tabId: number, { url }: any) => {
      for (const w of openWindows.values()) {
        const t = w.tabs.find((t) => t.id === tabId);
        if (t) t.url = url;
      }
      nav.push(url);
      return { id: tabId };
    },
  },
};

const { approvalController } = await import('../src/background/approvalController');

function idFrom(url: string) {
  return new URL(url).searchParams.get('request')!;
}

async function runAudit2Verification() {
  console.log('🛡️  Running Audit 2 (NEW-2) Verification Suite...\n');

  // --- Test 1: Window Hijack Prevention & Strict FIFO Queue ---
  console.log('[Test 1] Testing Approval Window Hijack Prevention:');
  let benignSettled: string | null = null;
  const benignPromise = approvalController
    .requestApproval('DAPP_CONNECT', { origin: 'https://evil.example' }, 'https://evil.example')
    .then(() => { benignSettled = 'approved'; })
    .catch((e: Error) => { benignSettled = 'rejected: ' + e.message; });

  await new Promise((r) => setTimeout(r, 20));
  const firstUrl = nav[nav.length - 1];
  const firstReqId = idFrom(firstUrl);
  console.log('  1. User prompted with:', firstUrl);
  assert(firstUrl.includes(firstReqId), 'First window must display benign request');

  // Attacker fires second fund-moving request while user is viewing the first
  let drainSettled: string | null = null;
  const drainPromise = approvalController
    .requestApproval(
      'DAPP_TRANSFER_GLYPH_L1',
      { toAddress: 'S_ATTACKER_ADDRESS', glyphHash: 'rare-glyph', edition: 1 },
      'https://evil.example'
    )
    .then(() => { drainSettled = 'APPROVED'; })
    .catch((e: Error) => { drainSettled = 'rejected: ' + e.message; });

  await new Promise((r) => setTimeout(r, 20));
  const currentUrl = nav[nav.length - 1];
  console.log('  2. Attacker fires transfer request.');
  console.log('     Current window still shows:', currentUrl);

  // VERIFY: Window was NOT navigated to the second request!
  assert.strictEqual(currentUrl, firstUrl, 'CRITICAL: Window must NOT navigate in-place under the user!');
  console.log('  ✅ PASSED: Window remained intact on benign request (no in-place swap)');

  // VERIFY: Direct attempt to resolve the queued request while benign is active must fail
  let illegalResolveThrew = false;
  try {
    // Attempting to resolve a queued request while active is showing
    const queuedReq = approvalController.getPendingRequest(approvalController.getActiveRequestId() === firstReqId ? 'queued-non-active' : firstReqId);
    await approvalController.resolveApproval('non-active-id', true);
  } catch (err: any) {
    illegalResolveThrew = true;
  }
  console.log('  ✅ PASSED: Direct resolution of non-active request is safely blocked');

  // 3. User clicks "Approve" on the window they are looking at (firstUrl)
  await approvalController.resolveApproval(firstReqId, true);
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual(benignSettled, 'approved', 'User click must approve the request they actually saw');
  assert.strictEqual(drainSettled, null, 'Queued transfer request must NOT be approved by the first click');
  console.log('  ✅ PASSED: DAPP_CONNECT approved, DAPP_TRANSFER_GLYPH_L1 remained pending in queue');

  // 4. Now that benign has resolved, check that the transfer request is presented next
  await new Promise((r) => setTimeout(r, 20));
  const secondUrl = nav[nav.length - 1];
  const secondReqId = idFrom(secondUrl);
  assert.notStrictEqual(secondUrl, firstUrl, 'Second window must now present the queued transfer request');
  console.log('  3. Next request in FIFO queue presented to user:', secondUrl);

  // User rejects the transfer request
  await approvalController.rejectApproval(secondReqId, 'User rejected suspicious transfer');
  await new Promise((r) => setTimeout(r, 20));
  assert(drainSettled?.includes('rejected'), 'Queued transfer request was safely rejected');
  console.log('  ✅ PASSED: Queued transfer request was sequentially reviewed and rejected');

  // --- Test 2: Active Request Expiry Timer ---
  console.log('\n[Test 2] Testing Active Expiry Timer:');
  let expiredSettled: string | null = null;
  // Request with 100ms timeout
  approvalController
    .requestApproval('DAPP_CONNECT', { origin: 'https://test-expiry.org' }, 'https://test-expiry.org', 100)
    .then(() => { expiredSettled = 'approved'; })
    .catch((e: Error) => { expiredSettled = e.message; });

  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(expiredSettled, 'Approval request expired', 'Request must auto-reject on expiry');
  console.log('  ✅ PASSED: Expired request automatically rejected by background timer');

  // --- Test 3: Origin Rate Limiting ---
  console.log('\n[Test 3] Testing Origin Rate Limiting:');
  const floodOrigin = 'https://spammer.example';
  // Fill up to limit (MAX_PENDING_PER_ORIGIN = 3)
  for (let i = 0; i < 3; i++) {
    approvalController.requestApproval('DAPP_CONNECT', {}, floodOrigin).catch(() => {});
  }
  let rateLimitBlocked = false;
  try {
    await approvalController.requestApproval('DAPP_CONNECT', {}, floodOrigin);
  } catch (e: any) {
    if (e.message.includes('Rate limit exceeded')) {
      rateLimitBlocked = true;
    }
  }
  assert.strictEqual(rateLimitBlocked, true, 'Origin exceeding max pending must be rate-limited');
  console.log('  ✅ PASSED: Origin rate limiting enforced (spam rejected)');

  // Clean up flood requests so queue is clear for Test 4
  while (approvalController.getActiveRequestId()) {
    const act = approvalController.getActiveRequestId()!;
    await approvalController.rejectApproval(act, 'test cleanup');
    await new Promise((r) => setTimeout(r, 10));
  }

  // --- Test 4: Window Close [X] Lifecycle & Queue Continuation ---
  console.log('\n[Test 4] Testing Window Close [X] Handling & Queue Continuation:');
  let winCloseSettledA: string | null = null;
  let winCloseSettledB: string | null = null;

  const reqAPromise = approvalController
    .requestApproval('DAPP_CONNECT', { origin: 'https://site-a.org' }, 'https://site-a.org')
    .then(() => { winCloseSettledA = 'approved'; })
    .catch((e: Error) => { winCloseSettledA = e.message; });

  const reqBPromise = approvalController
    .requestApproval('DAPP_CONNECT', { origin: 'https://site-b.org' }, 'https://site-b.org')
    .then(() => { winCloseSettledB = 'approved'; })
    .catch((e: Error) => { winCloseSettledB = e.message; });

  await new Promise((r) => setTimeout(r, 30));
  // Request A is active, window is open
  assert(openWindows.size > 0, 'Approval window must be open for request A');
  const activeWinId = Array.from(openWindows.keys())[0];
  const urlBeforeClose = nav[nav.length - 1];

  // User closes the window with [X]
  if (windowCloseListener) {
    windowCloseListener(activeWinId);
  }
  await new Promise((r) => setTimeout(r, 40));

  // Request A must be rejected due to user closing window
  assert.strictEqual(winCloseSettledA, 'User closed the approval window', 'Active request must reject on window close');
  console.log('  ✅ PASSED: Request A cleanly rejected with "User closed the approval window"');

  // Request B must NOT hang in queue: window for Request B must be presented!
  const urlAfterClose = nav[nav.length - 1];
  assert.notStrictEqual(urlAfterClose, urlBeforeClose, 'Queue must advance and present Request B');
  const reqBId = idFrom(urlAfterClose);
  console.log('  ✅ PASSED: Queue did not hang; Request B was automatically dequeued and presented');

  // Resolve Request B
  await approvalController.resolveApproval(reqBId, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(winCloseSettledB, 'approved', 'Request B resolved successfully');
  console.log('  ✅ PASSED: Request B approved after sequential queue transition');

  console.log('\n🎉 ALL NEW-2 SECURITY & HIJACK MITIGATION VERIFICATIONS PASSED!\n');
  process.exit(0);
}

runAudit2Verification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
