/**
 * Content Script: Bridges window.postMessage from inpage provider to chrome.runtime
 */

// Inject inpage provider script into document DOM
function injectProvider() {
  try {
    const container = document.head || document.documentElement;
    const script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.src = chrome.runtime.getURL('provider.js');
    script.onload = () => {
      script.remove();
    };
    container.insertBefore(script, container.firstChild);
  } catch (err) {
    console.error('[Quavence Vault] Failed to inject provider:', err);
  }
}

injectProvider();

// Whitelist of public dApp methods permitted to be forwarded from page context
const ALLOWED_DAPP_MESSAGE_TYPES = new Set([
  'DAPP_REQUEST_ACCOUNTS',
  'DAPP_SIGN_MESSAGE',
  'DAPP_CLAIM_GLYPH',
  'DAPP_CLAIM_GLYPH_L1',
  'DAPP_TRANSFER_GLYPH_L1',
  'DAPP_BUY_GLYPH_L1',
]);

// Listen to messages from window (inpage provider) and forward to background
window.addEventListener('message', async (event) => {
  if (
    event.source !== window ||
    !event.data ||
    event.data.target !== 'quavence-contentscript'
  ) {
    return;
  }

  const { id, type, payload } = event.data;

  // Security gate: Never forward internal VAULT_* or APPROVAL_* messages from arbitrary web pages
  if (!ALLOWED_DAPP_MESSAGE_TYPES.has(type)) {
    window.postMessage(
      {
        target: 'quavence-inpage',
        id,
        ok: false,
        error: `Unauthorized message type: '${type}'. Only public dApp methods may be called from web pages.`,
      },
      '*'
    );
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type, payload });
    window.postMessage(
      {
        target: 'quavence-inpage',
        id,
        ok: response?.ok ?? false,
        data: response?.data,
        error: response?.error,
      },
      '*'
    );
  } catch (err: any) {
    window.postMessage(
      {
        target: 'quavence-inpage',
        id,
        ok: false,
        error: err.message || 'Failed to communicate with Quavence Vault background service',
      },
      '*'
    );
  }
});
