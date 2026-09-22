# Quavence Vault Extension

Official, secure, non-custodial Web3 browser extension for the **Quavence (QVNC)** blockchain ecosystem.

Built with modern Manifest V3, React 18, Vite, and auditable cryptographic primitives.

---

## ⚡ Quick Install in Chrome / Brave / Edge / Kiwi (Android)

> [!TIP]
> **No build or Node.js required!** You can install Quavence Vault in less than 60 seconds.

### Method 1: Ready-to-use ZIP Package (Fastest & Recommended)
1. Download **[`quavence-vault-extension-v0.1.4.zip`](./quavence-vault-extension-v0.1.4.zip)** (or from [GitHub Releases](https://github.com/quavence/quavence-vault/releases) / [quavence.com](https://quavence.com)).
2. Extract the `.zip` file into a local folder.
3. In your browser (Chrome / Brave / Edge / Kiwi), navigate to: `chrome://extensions` (or `brave://extensions`).
4. Enable the **Developer mode** toggle in the top-right corner.
5. Click **Load unpacked** and select the **extracted folder** (which contains `manifest.json` and `background.js` directly).
6. Done! The Quavence Vault icon will appear in your browser extensions bar.

---

### Method 2: From Cloned / Downloaded Repository
If you downloaded the repository as a ZIP from GitHub (`Code -> Download ZIP`) or cloned it via `git clone`:

> [!WARNING]
> **DO NOT select the repository root folder!** The repository root contains uncompiled TypeScript development files and will produce `Service worker registration failed. Status code: 3`.

👉 Always select the pre-compiled **`dist/`** folder located inside the repository:
1. Open `chrome://extensions` -> enable **Developer mode**.
2. Click **Load unpacked**.
3. Navigate into the repository and select the **`dist`** directory (`quavence-vault/dist`).

---

## Security Architecture

- **Sovereign Key Storage**: Seed phrases and private keys never leave the client device.
- **Hardware-Grade Encryption**: Encrypted locally using **AES-GCM-256** with **PBKDF2** (210,000 SHA-256 iterations) conforming to modern OWASP guidelines.
- **Session Auto-Lock**: Keys in active memory are managed strictly via isolated `chrome.storage.session` and automatically purged after 15 minutes of inactivity.
- **Approval Flow**: dApps cannot silently request signatures or claims. Every interactive call (`window.quavence.signMessage`, `window.quavence.claimGlyph`, `window.quavence.transferGlyph`, `window.quavence.buyGlyph`) triggers an explicit user approval prompt with origin verification.
- **PoUS AI Glyph Carrier UTXO Immunity**: Carrier UTXOs (0.0001 QVNC / 10,000 satoshis dust carrying on-chain NFT inscriptions) are strictly shielded and excluded from coin selection during standard coin transfers and fee payments, preventing accidental burning or loss of digital artifacts.
- **BIP Standards Compliance**:
  - **BIP-39**: 12/24-word deterministic mnemonic phrases.
  - **BIP-32 / BIP-44**: Derivation path `m/44'/9999'/0'/0/index`.
  - **Base58Check**: Generates native `S...` mainnet addresses (Pubkey Version `0x3F` / 63).
  - **Deterministic Signatures**: Secp256k1 with RFC6979 and low-S enforcement (`lowS: true`).

---

## Development & Build

### Prerequisites
- Node.js >= 18.x
- npm >= 9.x

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify Cryptographic Engine & Transaction Builder
Run the automated test suite verifying BIP-39 mnemonic derivation, WIF import/export, BlackCoin-compatible message signing, and Carrier UTXO immunity:
```bash
npm test
```
Or run individual suites:
```bash
npm run test:crypto    # BIP-39, BIP-44, WIF, and Secp256k1 signature verification
npm run test:tx        # Native P2PKH txBuilder & Carrier UTXO immunity verification
```

### 3. Build Extension Bundle
```bash
npm run build
```
Production assets are generated in the `./dist` folder.

### 4. Create Distributable Zip Package
```bash
npm run package
```
Generates `quavence-vault-extension-v0.1.3.zip` ready for Chromium distribution.

---

## Installation in Chrome / Brave / Edge

1. Open your Chromium browser and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `quavence-vault-extension/dist` directory (or extract the `.zip` package).
5. The **Quavence Vault** icon will appear in your browser toolbar.

---

## In-Page dApp Provider API

When injected into web pages, the extension exposes a standard non-custodial provider under `window.quavence`:

```typescript
// Check if Quavence Vault is installed
if (window.quavence) {
  // 1. Request active address
  const [address] = await window.quavence.requestAccounts();
  console.log('Connected address:', address);

  // 2. Sign verification message (Requires user approval popup)
  const { signature } = await window.quavence.signMessage('Verify ownership of ' + address);
  console.log('Cryptographic signature:', signature);

  // 3. Claim PoUS Glyph artifact
  const claimResult = await window.quavence.claimGlyph({
    dropId: 20,
    slotId: 3,
  });
  console.log('Claim Attestation:', claimResult);

  // 4. Transfer PoUS Glyph on L1 with carrier preservation
  const transferResult = await window.quavence.transferGlyph({
    toAddress: 'SN6UdkEgxgXPv9ueZzEeVZ45XT44rxCbqY',
    glyphHash: 'd7a8fbb...',
    edition: 3,
    carrierTxid: 'a1b2c3...',
  });
  console.log('Transfer TxID:', transferResult.txid);

  // 5. Buy PoUS Glyph on L1 Marketplace
  const buyResult = await window.quavence.buyGlyph({
    listingId: 42,
    edition: 3,
    priceQvnc: 15.5,
    sellerAddress: 'Sh5hhLFgHroRCLTb9AHnDPMvpMVoLsQQw1',
    sellerSat: 1550000000,
    feeRecipientAddress: 'SWiB7o1ENxMQz2jWzgVBQcfxXNJpyFEKL8',
    feeSat: 38750000,
  });
  console.log('Purchase TxID:', buyResult.txid);
}
```

---

## Release History

- **v0.1.4**: Security remediation for Audit 4 (PUB-02, PUB-03). Enforced fail-loudly validation on glyph carrier UTXO mismatch (`carrierTxid` and `carrierVout`), preventing unintended burn of non-carrier UTXOs. Disambiguated network mining fee from carrier inscription value in approval prompts. Added GitHub Actions CI workflow and automated regression test suite.
- **v0.1.3**: Security remediation for NEW-2 (Approval Window Hijacking). Implemented strict FIFO approval queue, disabled in-place navigation of open prompt windows, added 800ms UI mount cooldown (`approvalCooldown`), background expiry timers with `.unref()`, and per-origin rate limiting.
- **v0.1.2**: Security remediation for QV-2026-001. Origin privilege isolation gating all internal `VAULT_*` and `APPROVAL_*` message handlers behind trusted extension popup/sidepanel URLs.
- **v0.1.0**: Initial release with native BIP-39/BIP-44 keychain, Carrier UTXO dust immunity, and dApp provider.

---

## License
This project is open-source under the [MIT License](LICENSE).
