import { KeyringController } from './keyring';
import { approvalController } from './approvalController';

export const keyring = new KeyringController();

export interface ExtensionMessage {
  type: string;
  payload?: any;
}

export async function handleExtensionMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  try {
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : 'unknown');

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
        return { ok: true, data: mnemonic };
      }

      case 'VAULT_SIGN_TRANSACTION': {
        const { utxos, toAddress, amountSat, feeSat } = message.payload;
        const res = await keyring.signTransaction({ utxos, toAddress, amountSat, feeSat });
        return { ok: true, data: res };
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
        const { id } = message.payload || {};
        const req = id ? approvalController.getPendingRequest(id) : null;
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
      case 'DAPP_REQUEST_ACCOUNTS': {
        const isUnlocked = await keyring.isUnlocked();
        if (!isUnlocked) {
          return { ok: false, error: 'Wallet is locked. Please unlock Quavence Vault.' };
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

      default:
        return { ok: false, error: `Unknown message type: ${message.type}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Internal extension error' };
  }
}
