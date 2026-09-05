import { handleExtensionMessage } from './messageRouter';

// Register background service worker listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleExtensionMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  // Keep channel open for async response
  return true;
});

// Keep action click behavior as popup
if ((chrome as any)?.sidePanel?.setPanelBehavior) {
  (chrome as any).sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

console.log('[Quavence Vault] Background Service Worker initialized.');
