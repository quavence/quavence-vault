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
