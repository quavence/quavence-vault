/**
 * Inpage Provider for Quavence Web3 dApps.
 * Injected directly into window.quavence.
 */

export interface QuavenceProvider {
  isQuavence: true;
  version: string;
  requestAccounts(): Promise<string[]>;
  signMessage(message: string): Promise<{ signature: string; address: string }>;
  claimGlyph(payload: {
    dropId: number;
    slotId: number;
    sessionUuid?: string;
    dropLabel?: string;
    slotName?: string;
    imageRef?: string;
    svgContent?: string;
    rarity?: string;
    theme?: string;
    edition?: number;
    glyphHash?: string;
    coinReward?: number | string;
  }): Promise<{ txHash?: string; address: string; signature?: string; claimPayload?: string }>;
  claimGlyphL1(payload: {
    dropId: number;
    slotId: number;
    sessionUuid?: string;
    glyphHash?: string;
    edition?: number;
    utxos: any[];
    feeSat?: number;
    dustSat?: number;
    dropLabel?: string;
    slotName?: string;
    imageRef?: string;
    svgContent?: string;
    rarity?: string;
    theme?: string;
  }): Promise<{ address: string; rawHex: string; txid: string; feeSat: number; opReturnHex: string }>;
  on(event: string, handler: (...args: any[]) => void): void;
  removeListener(event: string, handler: (...args: any[]) => void): void;
}

class QuavenceInpageProvider implements QuavenceProvider {
  public readonly isQuavence = true;
  public readonly version = '0.1.0';
  private listeners: Record<string, ((...args: any[]) => void)[]> = {};

  constructor() {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || event.data.target !== 'quavence-inpage') {
        return;
      }
      const { type, payload } = event.data;
      if (type === 'EVENT_ACCOUNTS_CHANGED') {
        this.emit('accountsChanged', payload);
      }
    });
  }

  async requestAccounts(): Promise<string[]> {
    return this.postRequest('DAPP_REQUEST_ACCOUNTS');
  }

  async signMessage(message: string): Promise<{ signature: string; address: string }> {
    return this.postRequest('DAPP_SIGN_MESSAGE', { message });
  }

  async claimGlyph(payload: {
    dropId: number;
    slotId: number;
    sessionUuid?: string;
  }): Promise<{ txHash: string; address: string }> {
    return this.postRequest('DAPP_CLAIM_GLYPH', payload);
  }

  async claimGlyphL1(payload: {
    dropId: number;
    slotId: number;
    sessionUuid?: string;
    glyphHash?: string;
    edition?: number;
    utxos: any[];
    feeSat?: number;
    dustSat?: number;
    dropLabel?: string;
    slotName?: string;
    imageRef?: string;
    svgContent?: string;
    rarity?: string;
    theme?: string;
  }): Promise<{ address: string; rawHex: string; txid: string; feeSat: number; opReturnHex: string }> {
    return this.postRequest('DAPP_CLAIM_GLYPH_L1', payload);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeListener(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  private emit(event: string, ...args: any[]): void {
    if (!this.listeners[event]) return;
    for (const h of this.listeners[event]) {
      try {
        h(...args);
      } catch (err) {
        console.error('[Quavence Provider Listener Error]', err);
      }
    }
  }

  private postRequest<T = any>(type: string, payload?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

      const handler = (event: MessageEvent) => {
        if (
          event.source !== window ||
          !event.data ||
          event.data.target !== 'quavence-inpage' ||
          event.data.id !== id
        ) {
          return;
        }

        window.removeEventListener('message', handler);
        const { ok, data, error } = event.data;
        if (ok) {
          resolve(data as T);
        } else {
          reject(new Error(error || 'Quavence Vault request rejected'));
        }
      };

      window.addEventListener('message', handler);

      window.postMessage(
        {
          target: 'quavence-contentscript',
          id,
          type,
          payload,
        },
        '*'
      );
    });
  }
}

// Inject into window if in browser context
if (typeof window !== 'undefined') {
  (window as any).quavence = new QuavenceInpageProvider();
  window.dispatchEvent(new CustomEvent('quavence#initialized'));
}
