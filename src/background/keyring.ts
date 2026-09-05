import { VAULT_SECURITY } from '../shared/constants';
import { EncryptedVault, encryptMnemonic, decryptMnemonic } from './vault';
import { mnemonicToSeed } from '../shared/crypto/mnemonic';
import { deriveAccountFromSeed, HDAccount } from '../shared/crypto/derivation';
import { signMessage } from '../shared/crypto/signing';
import { buildAndSignTransaction, buildAndSignGlyphTx, UTXO, GlyphMeta } from '../shared/crypto/txBuilder';

const STORAGE_KEYS = {
  VAULT: 'quavence_vault',
  ACCOUNTS_COUNT: 'quavence_accounts_count',
} as const;

const SESSION_KEYS = {
  SEED: 'quavence_session_seed',
  LAST_ACTIVE: 'quavence_session_last_active',
} as const;

export interface PublicAccountInfo {
  index: number;
  address: string;
  name: string;
}

export class KeyringController {
  private activeAccount: HDAccount | null = null;

  /**
   * Check if an encrypted vault exists in local storage.
   */
  async hasVault(): Promise<boolean> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.VAULT);
    return Boolean(result[STORAGE_KEYS.VAULT]);
  }

  /**
   * Initialize a new vault with a mnemonic and master password.
   */
  async createVault(mnemonic: string, password: string): Promise<PublicAccountInfo> {
    const vault = await encryptMnemonic(mnemonic, password);
    await chrome.storage.local.set({
      [STORAGE_KEYS.VAULT]: vault,
      [STORAGE_KEYS.ACCOUNTS_COUNT]: 1,
    });

    const seed = mnemonicToSeed(mnemonic);
    this.activeAccount = deriveAccountFromSeed(seed, 0);

    await this.setSessionSeed(seed);

    return {
      index: this.activeAccount.index,
      address: this.activeAccount.address,
      name: 'Account 1',
    };
  }

  /**
   * Unlock the vault using the master password.
   */
  async unlock(password: string): Promise<PublicAccountInfo> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.VAULT);
    const vault = result[STORAGE_KEYS.VAULT] as EncryptedVault | undefined;
    if (!vault) {
      throw new Error('No vault found. Please create or import a wallet first.');
    }

    const mnemonic = await decryptMnemonic(vault, password);
    const seed = mnemonicToSeed(mnemonic);

    this.activeAccount = deriveAccountFromSeed(seed, 0);
    await this.setSessionSeed(seed);

    return {
      index: this.activeAccount.index,
      address: this.activeAccount.address,
      name: 'Account 1',
    };
  }

  /**
   * Lock the vault and immediately clear keys from memory and session storage.
   */
  async lock(): Promise<void> {
    this.activeAccount = null;
    await chrome.storage.session.remove([SESSION_KEYS.SEED, SESSION_KEYS.LAST_ACTIVE]);
  }

  /**
   * Check if the vault is currently unlocked and session is not expired.
   */
  async isUnlocked(): Promise<boolean> {
    if (this.activeAccount) {
      const isExpired = await this.checkSessionExpiry();
      if (!isExpired) return true;
    }

    // Try restoring from chrome.storage.session
    const sessionData = await chrome.storage.session.get([SESSION_KEYS.SEED, SESSION_KEYS.LAST_ACTIVE]);
    const seedArray = sessionData[SESSION_KEYS.SEED] as number[] | undefined;
    const lastActive = sessionData[SESSION_KEYS.LAST_ACTIVE] as number | undefined;

    if (!seedArray || !lastActive) {
      return false;
    }

    const now = Date.now();
    if (now - lastActive > VAULT_SECURITY.AUTO_LOCK_TIMEOUT_MS) {
      await this.lock();
      return false;
    }

    const seed = new Uint8Array(seedArray);
    this.activeAccount = deriveAccountFromSeed(seed, 0);
    await chrome.storage.session.set({ [SESSION_KEYS.LAST_ACTIVE]: now });
    return true;
  }

  /**
   * Get the primary address of the currently active account.
   */
  async getActiveAddress(): Promise<string> {
    const unlocked = await this.isUnlocked();
    if (!unlocked || !this.activeAccount) {
      throw new Error('Wallet is locked. Unlock before requesting address.');
    }
    return this.activeAccount.address;
  }

  /**
   * Sign a message with the currently active account.
   */
  async signMessage(message: string): Promise<{ signature: string; address: string }> {
    const unlocked = await this.isUnlocked();
    if (!unlocked || !this.activeAccount) {
      throw new Error('Wallet is locked.');
    }

    const signature = await signMessage(message, this.activeAccount.privKey);
    await this.touchSession();

    return {
      signature,
      address: this.activeAccount.address,
    };
  }

  /**
   * Build, sign and return raw transaction hex using active account's private key.
   */
  async signTransaction(params: {
    utxos: UTXO[];
    toAddress: string;
    amountSat: number;
    feeSat?: number;
  }): Promise<{ rawHex: string; txid: string; feeSat: number }> {
    const unlocked = await this.isUnlocked();
    if (!unlocked || !this.activeAccount) {
      throw new Error('Wallet is locked. Please unlock Quavence Vault.');
    }

    return buildAndSignTransaction({
      utxos: params.utxos,
      fromAddress: this.activeAccount.address,
      toAddress: params.toAddress,
      amountSat: params.amountSat,
      feeSat: params.feeSat,
      privKey: this.activeAccount.privKey,
    });
  }

  /**
   * Build and sign an L1 Glyph UTXO transaction with OP_RETURN protocol payload.
   */
  async signGlyphTransaction(params: {
    utxos: UTXO[];
    toAddress: string;
    glyphMeta: GlyphMeta;
    feeSat?: number;
    dustSat?: number;
  }): Promise<{ rawHex: string; txid: string; feeSat: number; opReturnHex: string }> {
    const unlocked = await this.isUnlocked();
    if (!unlocked || !this.activeAccount) {
      throw new Error('Wallet is locked. Please unlock Quavence Vault.');
    }

    return buildAndSignGlyphTx({
      utxos: params.utxos,
      fromAddress: this.activeAccount.address,
      toAddress: params.toAddress,
      glyphMeta: params.glyphMeta,
      feeSat: params.feeSat,
      dustSat: params.dustSat,
      privKey: this.activeAccount.privKey,
    });
  }

  /**
   * Export the plaintext mnemonic phrase after password verification.
   */
  async exportMnemonic(password: string): Promise<string> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.VAULT);
    const vault = result[STORAGE_KEYS.VAULT] as EncryptedVault | undefined;
    if (!vault) {
      throw new Error('No vault found.');
    }
    return decryptMnemonic(vault, password);
  }

  /**
   * Store binary seed in RAM-only session storage.
   */
  private async setSessionSeed(seed: Uint8Array): Promise<void> {
    await chrome.storage.session.set({
      [SESSION_KEYS.SEED]: Array.from(seed),
      [SESSION_KEYS.LAST_ACTIVE]: Date.now(),
    });
  }

  private async touchSession(): Promise<void> {
    await chrome.storage.session.set({
      [SESSION_KEYS.LAST_ACTIVE]: Date.now(),
    });
  }

  private async checkSessionExpiry(): Promise<boolean> {
    const sessionData = await chrome.storage.session.get(SESSION_KEYS.LAST_ACTIVE);
    const lastActive = sessionData[SESSION_KEYS.LAST_ACTIVE] as number | undefined;
    if (!lastActive) return true;
    if (Date.now() - lastActive > VAULT_SECURITY.AUTO_LOCK_TIMEOUT_MS) {
      await this.lock();
      return true;
    }
    return false;
  }
}
