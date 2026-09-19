/**
 * Approval Controller: manages user confirmation prompts for dApp interactions
 */

export interface PendingRequest {
  id: string;
  type: 'DAPP_SIGN_MESSAGE' | 'DAPP_CLAIM_GLYPH' | 'DAPP_CLAIM_GLYPH_L1' | 'DAPP_CONNECT' | 'DAPP_TRANSFER_GLYPH_L1' | 'DAPP_BUY_GLYPH_L1';
  origin: string;
  payload: any;
  createdAt: number;
  expiresAt: number;
}

type Resolver = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

class ApprovalController {
  private pending = new Map<string, { request: PendingRequest; resolver: Resolver }>();
  private activeWindowId: number | null = null;
  private connectedOrigins = new Set<string>();
  private initializedOrigins = false;

  async initConnectedOrigins(): Promise<void> {
    if (this.initializedOrigins) return;
    try {
      const stored = await chrome.storage?.local?.get('connected_origins');
      const list: string[] = stored?.connected_origins || [];
      this.connectedOrigins = new Set(list);
      this.initializedOrigins = true;
    } catch {
      this.initializedOrigins = true;
    }
  }

  async isConnected(origin: string): Promise<boolean> {
    await this.initConnectedOrigins();
    return this.connectedOrigins.has(origin);
  }

  async connectOrigin(origin: string): Promise<void> {
    await this.initConnectedOrigins();
    if (this.connectedOrigins.has(origin)) return;

    // Prompt user with popup
    await this.requestApproval('DAPP_CONNECT', { origin }, origin);
    this.connectedOrigins.add(origin);
    try {
      const stored = await chrome.storage?.local?.get('connected_origins');
      const list: string[] = stored?.connected_origins || [];
      if (!list.includes(origin)) {
        await chrome.storage?.local?.set({ connected_origins: [...list, origin] });
      }
    } catch {}
  }

  async requestApproval<T = any>(
    type: PendingRequest['type'],
    payload: any,
    origin: string
  ): Promise<T> {
    const id = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

    const now = Date.now();
    const request: PendingRequest = {
      id,
      type,
      origin,
      payload,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000, // 5 minutes validity
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
      if (Date.now() > item.request.expiresAt) {
        this.pending.delete(id);
        item.resolver.reject(new Error('Approval request expired'));
        await chrome.storage.session?.remove?.('current_pending_request').catch(() => {});
        this.closeActiveWindow();
        return;
      }
      item.resolver.resolve(result);
      this.pending.delete(id);
    }
    await chrome.storage.session?.remove?.('current_pending_request').catch(() => {});
    this.closeActiveWindow();
  }

  async rejectApproval(id: string, reason = 'User rejected the request'): Promise<void> {
    const item = this.pending.get(id);
    if (item) {
      item.resolver.reject(new Error(reason));
      this.pending.delete(id);
    }
    await chrome.storage.session?.remove?.('current_pending_request').catch(() => {});
    this.closeActiveWindow();
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
