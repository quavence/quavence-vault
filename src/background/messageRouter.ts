import { KeyringController } from './keyring';
import { approvalController } from './approvalController';
import { NETWORK } from '../shared/constants';

export const keyring = new KeyringController();

export interface ExtensionMessage {
  type: string;
  payload?: any;
}

// Internal methods restricted exclusively to Quavence Vault's own extension UI (popup/sidepanel)
const INTERNAL_MESSAGE_TYPES = new Set([
  'VAULT_HAS_VAULT',
  'VAULT_IS_UNLOCKED',
  'VAULT_CREATE',
  'VAULT_UNLOCK',
  'VAULT_LOCK',
  'VAULT_GET_ACCOUNT',
  'VAULT_EXPORT_MNEMONIC',
  'VAULT_SIGN_TRANSACTION',
  'VAULT_SEND_GLYPH_L1',
  'APPROVAL_GET_PENDING',
  'APPROVAL_RESOLVE',
  'APPROVAL_REJECT',
]);

let cachedTrustedPages: Set<string> | null = null;

function getTrustedExtensionPages(): Set<string> {
  if (!cachedTrustedPages) {
    cachedTrustedPages = new Set<string>();
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
      try {
        cachedTrustedPages.add(chrome.runtime.getURL('popup.html'));
        cachedTrustedPages.add(chrome.runtime.getURL('sidepanel.html'));
      } catch {}
    }
  }
  return cachedTrustedPages;
}

export function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) return false; // content scripts in browser tabs are not trusted for internal methods
  if (!sender.url) return false;

  const senderBase = sender.url.split('?')[0].split('#')[0];
  const trusted = getTrustedExtensionPages();
  if (trusted.has(senderBase)) return true;

  // Fallback for dynamic / test environments
  if (senderBase.endsWith('/popup.html') || senderBase.endsWith('/sidepanel.html')) {
    return true;
  }

  return false;
}

export async function handleExtensionMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  try {
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : 'unknown');

    // Security check: Only verified internal extension UI pages (popup/sidepanel) may call VAULT_* or APPROVAL_*
    const isInternalSender = isTrustedSender(sender);

    if (INTERNAL_MESSAGE_TYPES.has(message.type) && !isInternalSender) {
      console.warn(
        `[Security Alert] Blocked unauthorized attempt to invoke internal method '${message.type}' from external sender/tab:`,
        { origin, tabId: sender.tab?.id, url: sender.url }
      );
      return {
        ok: false,
        error: `Forbidden: '${message.type}' is an internal extension method and cannot be invoked by external web pages.`,
      };
    }

    switch (message.type) {
      case 'VAULT_HAS_VAULT':
        return { ok: true, data: await keyring.hasVault() };

      case 'VAULT_IS_UNLOCKED':
        return { ok: true, data: await keyring.isUnlocked() };

      case 'VAULT_CREATE': {
        const { mnemonic, password } = message.payload;
        const account = await keyring.createVault(mnemonic, password);
        return { ok: true, data: account };
      }

      case 'VAULT_UNLOCK': {
        const { password } = message.payload;
        const account = await keyring.unlock(password);
        return { ok: true, data: account };
      }

      case 'VAULT_LOCK':
        await keyring.lock();
        return { ok: true };

      case 'VAULT_GET_ACCOUNT': {
        const address = await keyring.getActiveAddress();
        return { ok: true, data: { address, name: 'Account 1' } };
      }

      case 'VAULT_EXPORT_MNEMONIC': {
        const { password } = message.payload;
        const mnemonic = await keyring.exportMnemonic(password);
        return { ok: true, data: { mnemonic } };
      }

      case 'VAULT_SIGN_TRANSACTION': {
        const { utxos, excludeUtxos, toAddress, amountSat, feeSat } = message.payload;
        const signedTx = await keyring.signTransaction({
          utxos,
          excludeUtxos,
          toAddress,
          amountSat,
          feeSat,
        });
        return { ok: true, data: signedTx };
      }

      case 'VAULT_SEND_GLYPH_L1': {
        const { utxos, toAddress, glyphMeta, feeSat, dustSat } = message.payload;
        const res = await keyring.signGlyphTransaction({
          utxos,
          toAddress,
          glyphMeta,
          feeSat,
          dustSat,
        });
        return { ok: true, data: res };
      }

      // Internal approval management from popup UI
      case 'APPROVAL_GET_PENDING': {
        const { id } = message.payload;
        const req = approvalController.getPendingRequest(id);
        return { ok: true, data: req };
      }

      case 'APPROVAL_RESOLVE': {
        const { id, result } = message.payload;
        await approvalController.resolveApproval(id, result);
        return { ok: true };
      }

      case 'APPROVAL_REJECT': {
        const { id, reason } = message.payload;
        await approvalController.rejectApproval(id, reason);
        return { ok: true };
      }

      // dApp External API
      case 'DAPP_CONNECT': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault.' };
        }
        if (!(await approvalController.isConnected(origin))) {
          await approvalController.connectOrigin(origin);
        }
        const address = await keyring.getActiveAddress();
        return { ok: true, data: { address, connected: true } };
      }

      case 'DAPP_REQUEST_ACCOUNTS': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault.' };
        }
        // Require explicit user connect-approval before disclosing address
        if (!(await approvalController.isConnected(origin))) {
          await approvalController.connectOrigin(origin);
        }
        const address = await keyring.getActiveAddress();
        return { ok: true, data: [address] };
      }

      case 'DAPP_SIGN_MESSAGE': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault to sign messages.' };
        }

        const { message: messageToSign } = message.payload;
        if (!messageToSign || typeof messageToSign !== 'string') {
          return { ok: false, error: 'Invalid message payload' };
        }

        // Require user approval through popup UI
        await approvalController.requestApproval(
          'DAPP_SIGN_MESSAGE',
          { message: messageToSign },
          origin
        );

        // Once approved by user, generate cryptographic signature
        const res = await keyring.signMessage(messageToSign);
        return { ok: true, data: res };
      }

      case 'DAPP_CLAIM_GLYPH': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault to claim glyphs.' };
        }

        const { dropId, slotId, sessionUuid } = message.payload || {};
        if (dropId === undefined || slotId === undefined) {
          return { ok: false, error: 'Missing required parameters: dropId and slotId' };
        }

        const address = await keyring.getActiveAddress();

        // Require user approval through popup UI with all rich metadata and active address
        await approvalController.requestApproval(
          'DAPP_CLAIM_GLYPH',
          {
            ...message.payload,
            activeAddress: address,
          },
          origin
        );

        // Sign attestation payload for the claim
        const claimPayloadStr = `CLAIM_GLYPH:drop=${dropId}:slot=${slotId}:addr=${address}${sessionUuid ? `:uuid=${sessionUuid}` : ''}`;
        const signatureRes = await keyring.signMessage(claimPayloadStr);

        return {
          ok: true,
          data: {
            address,
            signature: signatureRes.signature,
            claimPayload: claimPayloadStr,
          },
        };
      }

      case 'DAPP_CLAIM_GLYPH_L1': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault.' };
        }

        const { glyphMeta, utxos, feeSat, dustSat } = message.payload || {};
        const address = await keyring.getActiveAddress();

        await approvalController.requestApproval(
          'DAPP_CLAIM_GLYPH_L1',
          {
            ...message.payload,
            activeAddress: address,
          },
          origin
        );

        const glyphTx = await keyring.signGlyphTransaction({
          utxos,
          toAddress: address,
          glyphMeta: glyphMeta || {
            glyphId: message.payload?.glyphHash || String(message.payload?.slotId || '0'),
            edition: Number(message.payload?.edition || message.payload?.slotId || 0),
            opType: 0x01,
          },
          feeSat,
          dustSat,
        });

        return {
          ok: true,
          data: {
            address,
            rawHex: glyphTx.rawHex,
            txid: glyphTx.txid,
            feeSat: glyphTx.feeSat,
            opReturnHex: glyphTx.opReturnHex,
          },
        };
      }

      case 'DAPP_TRANSFER_GLYPH_L1': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault.' };
        }

        const { toAddress, glyphHash, edition, slotId, feeSat, dustSat, carrierTxid } = message.payload || {};
        if (!toAddress) {
          return { ok: false, error: 'toAddress is required for L1 glyph deposit.' };
        }

        const address = await keyring.getActiveAddress();

        // 1. Prompt user approval in popup UI
        await approvalController.requestApproval(
          'DAPP_TRANSFER_GLYPH_L1',
          {
            ...message.payload,
            activeAddress: address,
          },
          origin
        );

        // 2. Fetch spendable UTXOs for active address from network if not supplied
        let utxos = message.payload?.utxos;
        if (!Array.isArray(utxos) || utxos.length === 0) {
          try {
            const utxoRes = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/address/${encodeURIComponent(address)}`);
            if (utxoRes.ok) {
              const addrData = await utxoRes.json();
              if (Array.isArray(addrData.utxos) && addrData.utxos.length > 0) {
                utxos = addrData.utxos;
              }
            }
          } catch {}
        }

        if (!Array.isArray(utxos) || utxos.length === 0) {
          throw new Error('No spendable UTXOs found for this address to cover carrier dust and miner fee.');
        }

        // 3. Sign L1 Glyph Transfer transaction (opType 0x03)
        const glyphTx = await keyring.signGlyphTransaction({
          utxos,
          toAddress,
          glyphMeta: {
            glyphId: glyphHash || String(slotId || '0'),
            edition: Number(edition || slotId || 0),
            opType: 0x03, // TRANSFER
            carrierTxid,
          },
          feeSat: feeSat || 10000,
          dustSat: dustSat || 10000,
        });

        // 4. Broadcast on-chain to Quavence L1 node
        const bRes = await fetch(`${NETWORK.DEFAULT_DAO_URL}/api/glyphs/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawHex: glyphTx.rawHex,
            isTransfer: true,
            action: 'transfer',
            glyphHash,
            edition,
            fromAddress: address,
            toAddress,
            txid: glyphTx.txid,
            opReturnHex: glyphTx.opReturnHex,
          }),
        });
        const bJson = await bRes.json().catch(() => ({}));
        if (!bRes.ok || !bJson.ok || !bJson.data?.txid) {
          throw new Error(bJson.error || `Network rejected raw L1 glyph transfer (HTTP ${bRes.status})`);
        }
        const finalTxid = bJson.data.txid;

        return {
          ok: true,
          data: {
            address,
            txid: finalTxid,
            rawHex: glyphTx.rawHex,
            opReturnHex: glyphTx.opReturnHex,
          },
        };
      }

      case 'DAPP_BUY_GLYPH_L1': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault.' };
        }

        const {
          listingId,
          edition,
          sellerAddress,
          sellerSat,
          feeRecipientAddress,
          feeSat,
          feePercent,
          priceQvnc,
          name,
          rarity,
        } = message.payload || {};

        if (!sellerAddress || !sellerSat || sellerSat <= 0) {
          return { ok: false, error: 'Invalid seller output details for glyph purchase.' };
        }

        const address = await keyring.getActiveAddress();

        // 1. Prompt user approval in popup UI
        await approvalController.requestApproval(
          'DAPP_BUY_GLYPH_L1',
          {
            ...message.payload,
            activeAddress: address,
          },
          origin
        );

        // 2. Fetch spendable UTXOs for active address
        let utxos = message.payload?.utxos;
        const carrierExcludeList: Array<{ txid: string; vout_index: number }> = [];

        if (!Array.isArray(utxos) || utxos.length === 0) {
          try {
            const utxoRes = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/address/${encodeURIComponent(address)}`);
            if (utxoRes.ok) {
              const addrData = await utxoRes.json();
              if (Array.isArray(addrData.glyphs)) {
                addrData.glyphs.forEach((g: any) => {
                  if (g.txid) {
                    carrierExcludeList.push({ txid: g.txid, vout_index: g.carrierVout ?? 0 });
                  }
                });
              }
              if (Array.isArray(addrData.utxos) && addrData.utxos.length > 0) {
                utxos = addrData.utxos;
              }
            }
          } catch {}
        }

        if (!Array.isArray(utxos) || utxos.length === 0) {
          throw new Error('No spendable UTXOs found for this address to cover purchase payment and miner fee.');
        }

        // 3. Build multi-output payment: seller + fee recipient (if fee > 0)
        const outputs: { address: string; amountSat: number }[] = [
          { address: sellerAddress, amountSat: Math.round(sellerSat) },
        ];

        if (feeRecipientAddress && feeSat && feeSat > 0) {
          outputs.push({ address: feeRecipientAddress, amountSat: Math.round(feeSat) });
        }

        // 4. Sign native payment transaction with carrier protection
        const payTx = await keyring.signTransaction({
          utxos,
          outputs,
          feeSat: 10000,
          excludeUtxos: carrierExcludeList,
        });

        // 5. Broadcast transaction on-chain
        const bRes = await fetch(`${NETWORK.DEFAULT_DAO_URL}/api/glyphs/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawHex: payTx.rawHex,
            fromAddress: address,
            toAddress: sellerAddress,
            txid: payTx.txid,
          }),
        });
        const bJson = await bRes.json().catch(() => ({}));
        if (!bRes.ok || !bJson.ok || !bJson.data?.txid) {
          throw new Error(bJson.error || `Network rejected raw L1 glyph purchase transaction (HTTP ${bRes.status})`);
        }
        const finalTxid = bJson.data.txid;

        return {
          ok: true,
          data: {
            address,
            txid: finalTxid,
            rawHex: payTx.rawHex,
          },
        };
      }

      default:
        return { ok: false, error: `Unknown message type: ${message.type}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Internal extension error' };
  }
}
