/**
 * Approval Controller: manages user confirmation prompts for dApp interactions
 * Hardened against approval window hijacking (NEW-2 / Audit 2):
 * 1. Strict FIFO queue: never navigates an open approval window to a different request.
 * 2. Active expiration timer: automatically rejects expired requests.
 * 3. Origin rate-limiting: caps pending requests and request frequency per origin.
 * 4. Window lifecycle tracking: cleanly handles window close and sequential presentation.
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

interface PendingEntry {
  request: PendingRequest;
  resolver: Resolver;
  timer?: any;
}

class ApprovalController {
  private pending = new Map<string, PendingEntry>();
  private queue: string[] = []; // IDs of requests waiting in FIFO order
  private activeRequestId: string | null = null;
  private activeWindowId: number | null = null;
  private connectedOrigins = new Set<string>();
  private initializedOrigins = false;
  private isProcessingQueue = false;

  // Rate limiting per origin & global queue limits
  private recentRequestsByOrigin = new Map<string, number[]>();
  private static readonly MAX_PENDING_PER_ORIGIN = 3;
  private static readonly MAX_GLOBAL_PENDING = 10;
  private static readonly RATE_LIMIT_WINDOW_MS = 10000; // 10s
  private static readonly RATE_LIMIT_MAX_REQUESTS = 5;
  private static readonly DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    try {
      chrome.windows?.onRemoved?.addListener((windowId) => {
        if (this.activeWindowId === windowId) {
          this.activeWindowId = null;
          if (this.activeRequestId) {
            const activeId = this.activeRequestId;
            // Do NOT nullify this.activeRequestId here; rejectApproval requires wasActive to advance the queue
            this.rejectApproval(activeId, 'User closed the approval window').catch(() => {});
          }
        }
      });
    } catch {}
  }

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

  async getConnectedOrigins(): Promise<string[]> {
    await this.initConnectedOrigins();
    return Array.from(this.connectedOrigins);
  }

  async disconnectOrigin(origin: string): Promise<void> {
    await this.initConnectedOrigins();
    this.connectedOrigins.delete(origin);
    try {
      const stored = await chrome.storage?.local?.get('connected_origins');
      const list: string[] = stored?.connected_origins || [];
      const updated = list.filter((o) => o !== origin);
      await chrome.storage?.local?.set({ connected_origins: updated });
    } catch {}
  }

  private checkRateLimit(origin: string): void {
    const now = Date.now();

    // 0. Global pending queue limit
    if (this.pending.size >= ApprovalController.MAX_GLOBAL_PENDING) {
      throw new Error('Approval queue is full. Please review or reject pending requests.');
    }

    // 1. Max pending per origin (including active and queued)
    let pendingCount = 0;
    for (const item of this.pending.values()) {
      if (item.request.origin === origin) {
        pendingCount++;
      }
    }
    if (pendingCount >= ApprovalController.MAX_PENDING_PER_ORIGIN) {
      throw new Error(`Rate limit exceeded: too many pending approval requests for origin ${origin}`);
    }

    // 2. Clean up stale timestamps across origins
    for (const [k, v] of this.recentRequestsByOrigin.entries()) {
      const active = v.filter(t => now - t < ApprovalController.RATE_LIMIT_WINDOW_MS);
      if (active.length === 0) {
        this.recentRequestsByOrigin.delete(k);
      } else {
        this.recentRequestsByOrigin.set(k, active);
      }
    }

    // 3. Request frequency window per origin
    let timestamps = this.recentRequestsByOrigin.get(origin) || [];
    if (timestamps.length >= ApprovalController.RATE_LIMIT_MAX_REQUESTS) {
      throw new Error(`Rate limit exceeded: too many approval requests from origin ${origin}`);
    }
    timestamps.push(now);
    this.recentRequestsByOrigin.set(origin, timestamps);
  }

  async requestApproval<T = any>(
    type: PendingRequest['type'],
    payload: any,
    origin: string,
    timeoutMs: number = ApprovalController.DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    this.checkRateLimit(origin);

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
      expiresAt: now + timeoutMs,
    };

    return new Promise<T>((resolve, reject) => {
      // Active timer to auto-reject on expiry
      const timer = setTimeout(() => {
        this.handleExpiry(id);
      }, timeoutMs);
      if (typeof (timer as any)?.unref === 'function') {
        (timer as any).unref();
      }

      this.pending.set(id, { request, resolver: { resolve, reject }, timer });
      this.queue.push(id);

      // Trigger queue processing: will present immediately if idle, or wait in queue
      this.processQueue().catch((err) => {
        this.cleanupRequest(id);
        reject(err);
      });
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      // If a request is already actively presented to the user, wait until it finishes!
      // Do NOT interrupt or navigate the open approval window to a different request!
      if (this.activeRequestId !== null) {
        if (this.pending.has(this.activeRequestId)) {
          return;
        }
        this.activeRequestId = null;
      }

      // Dequeue next valid request in FIFO order
      while (this.queue.length > 0) {
        const nextId = this.queue.shift()!;
        const item = this.pending.get(nextId);
        if (!item) {
          continue; // Expired or cancelled while queued
        }

        if (Date.now() > item.request.expiresAt) {
          this.cleanupRequest(nextId);
          item.resolver.reject(new Error('Approval request expired'));
          continue;
        }

        this.activeRequestId = nextId;

        // Persist active request to session storage for the popup
        try {
          await chrome.storage?.session?.set?.({ current_pending_request: item.request });
        } catch {}

        // Open approval window for this request
        await this.openApprovalWindow(nextId);
        return;
      }

      // No more requests in queue: clean up session storage and close window
      await this.clearCurrentPendingRequest();
      this.closeActiveWindow();
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async openApprovalWindow(requestId: string): Promise<void> {
    const popupUrl = chrome.runtime?.getURL?.(`popup.html?request=${requestId}`)
      || `popup.html?request=${requestId}`;

    if (this.activeWindowId !== null) {
      try {
        const win = await chrome.windows?.get?.(this.activeWindowId, { populate: true });
        if (win && win.tabs && win.tabs.length > 0 && win.tabs[0].id) {
          await chrome.tabs?.update?.(win.tabs[0].id, { url: popupUrl });
          await chrome.windows?.update?.(this.activeWindowId, { focused: true });
          return;
        }
      } catch {
        this.activeWindowId = null;
      }
      this.activeWindowId = null;
    }

    try {
      const win = await chrome.windows?.create?.({
        url: popupUrl,
        type: 'popup',
        width: 380,
        height: 640,
        focused: true,
      });
      this.activeWindowId = win?.id ?? null;
    } catch {
      // Fallback if popup creation restricted: create normal tab
      await chrome.tabs?.create?.({ url: popupUrl });
    }
  }

  private handleExpiry(id: string): void {
    const item = this.pending.get(id);
    if (!item) return;

    this.cleanupRequest(id);
    try {
      item.resolver.reject(new Error('Approval request expired'));
    } catch {}

    if (this.activeRequestId === id) {
      this.activeRequestId = null;
      this.closeActiveWindow();
      this.clearCurrentPendingRequest(id).catch(() => {});
      this.processQueue().catch(() => {});
    }
  }

  private cleanupRequest(id: string): void {
    const item = this.pending.get(id);
    if (item?.timer) {
      clearTimeout(item.timer);
    }
    this.pending.delete(id);
    this.queue = this.queue.filter(reqId => reqId !== id);
  }

  private async clearCurrentPendingRequest(id?: string): Promise<void> {
    try {
      if (!chrome.storage?.session) return;
      if (id) {
        const session = await chrome.storage.session.get('current_pending_request');
        if (session?.current_pending_request?.id && session.current_pending_request.id !== id) {
          // A newer request has already claimed session storage — do not delete it!
          return;
        }
      }
      await chrome.storage.session.remove('current_pending_request');
    } catch {}
  }

  async resolveApproval(id: string, result: any): Promise<void> {
    const item = this.pending.get(id);
    if (!item) {
      await this.clearCurrentPendingRequest(id);
      this.closeActiveWindow();
      return;
    }

    // Security: only the active request currently shown to the user can be approved!
    if (this.activeRequestId !== id) {
      throw new Error(`Cannot approve inactive or queued request ${id}; active request is ${this.activeRequestId}`);
    }

    this.cleanupRequest(id);
    this.activeRequestId = null;

    // Reset active window ID / close before resolving so chained requests cleanly start fresh
    this.closeActiveWindow();
    await this.clearCurrentPendingRequest(id);

    item.resolver.resolve(result);

    // Process next queued request in line
    this.processQueue().catch(() => {});
  }

  async rejectApproval(id: string, reason = 'User rejected the request'): Promise<void> {
    const item = this.pending.get(id);
    if (!item) {
      await this.clearCurrentPendingRequest(id);
      this.closeActiveWindow();
      return;
    }

    const wasActive = (this.activeRequestId === id);
    this.cleanupRequest(id);

    if (wasActive) {
      this.activeRequestId = null;
      this.closeActiveWindow();
      await this.clearCurrentPendingRequest(id);
    }

    item.resolver.reject(new Error(reason));

    if (wasActive) {
      this.processQueue().catch(() => {});
    }
  }

  getPendingRequest(id: string): PendingRequest | undefined {
    return this.pending.get(id)?.request;
  }

  getActiveRequestId(): string | null {
    return this.activeRequestId;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  private closeActiveWindow() {
    if (this.activeWindowId !== null) {
      const winId = this.activeWindowId;
      this.activeWindowId = null;
      chrome.windows?.remove?.(winId).catch(() => {});
    }
  }
}

export const approvalController = new ApprovalController();
