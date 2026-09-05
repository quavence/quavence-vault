/**
 * Approval Controller: manages user confirmation prompts for dApp interactions
 */

export interface PendingRequest {
  id: string;
  type: 'DAPP_SIGN_MESSAGE' | 'DAPP_CLAIM_GLYPH' | 'DAPP_CLAIM_GLYPH_L1' | 'DAPP_CONNECT';
  origin: string;
  payload: any;
  createdAt: number;
}

type Resolver = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

class ApprovalController {
  private pending = new Map<string, { request: PendingRequest; resolver: Resolver }>();
  private activeWindowId: number | null = null;

  async requestApproval<T = any>(
    type: PendingRequest['type'],
    payload: any,
    origin: string
  ): Promise<T> {
    const id = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

    const request: PendingRequest = {
      id,
      type,
      origin,
      payload,
      createdAt: Date.now(),
    };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { request, resolver: { resolve, reject } });

      // Persist active request to session storage so popup can read it
      chrome.storage.session?.set?.({ current_pending_request: request }).catch(() => {});

      // Open approval popup
      this.openApprovalWindow(id).catch((err) => {
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  async resolveApproval(id: string, result: any): Promise<void> {
    const item = this.pending.get(id);
    if (item) {
      item.resolver.resolve(result);
      this.pending.delete(id);
      await chrome.storage.session?.remove?.('current_pending_request').catch(() => {});
      this.closeActiveWindow();
    }
  }

  async rejectApproval(id: string, reason = 'User rejected the request'): Promise<void> {
    const item = this.pending.get(id);
    if (item) {
      item.resolver.reject(new Error(reason));
      this.pending.delete(id);
      await chrome.storage.session?.remove?.('current_pending_request').catch(() => {});
      this.closeActiveWindow();
    }
  }

  getPendingRequest(id: string): PendingRequest | undefined {
    return this.pending.get(id)?.request;
  }

  private async openApprovalWindow(requestId: string): Promise<void> {
    const popupUrl = chrome.runtime.getURL(`popup.html?request=${requestId}`);

    if (this.activeWindowId !== null) {
      try {
        await chrome.windows.update(this.activeWindowId, { focused: true });
        return;
      } catch {
        this.activeWindowId = null;
      }
    }

    try {
      const win = await chrome.windows.create({
        url: popupUrl,
        type: 'popup',
        width: 380,
        height: 640,
        focused: true,
      });
      this.activeWindowId = win.id ?? null;
    } catch {
      // Fallback if popup creation restricted: create normal tab
      await chrome.tabs.create({ url: popupUrl });
    }
  }

  private closeActiveWindow() {
    if (this.activeWindowId !== null) {
      chrome.windows.remove(this.activeWindowId).catch(() => {});
      this.activeWindowId = null;
    }
  }
}

export const approvalController = new ApprovalController();
