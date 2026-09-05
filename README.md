# Quavence Vault Extension

Official, secure, non-custodial Web3 browser extension for the **Quavence (QVNC)** blockchain ecosystem.

Built with modern Manifest V3, React 18, Vite, and auditable cryptographic primitives.

---

## Security Architecture

- **Sovereign Key Storage**: Seed phrases and private keys never leave the client device.
- **Hardware-Grade Encryption**: Encrypted locally using **AES-GCM-256** with **PBKDF2** (210,000 SHA-256 iterations) conforming to modern OWASP guidelines.
- **Session Auto-Lock**: Keys in active memory are managed strictly via isolated `chrome.storage.session` and automatically purged after 15 minutes of inactivity.
- **Approval Flow**: dApps cannot silently request signatures or claims. Every interactive call (`window.quavence.signMessage`, `window.quavence.claimGlyph`) triggers an explicit user approval prompt with origin verification.
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

### 2. Verify Cryptographic Engine
Run the automated cryptographic self-test verifying key derivation, WIF import/export, and BlackCoin-compatible message signing:
```bash
npm run test:crypto
```

### 3. Build Extension Bundle
```bash
npm run build
```
Production assets are generated in the `./dist` folder.

---

## Installation in Chrome / Brave / Edge

1. Open your Chromium browser and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the `quavence-vault-extension/dist` directory.
5. The **Quavence Vault** icon will appear in your browser toolbar.

---

## In-Page dApp Provider API

When injected into web pages, the extension exposes a standard non-custodial provider under `window.quavence`:

```typescript
// Check if Quavence Vault is installed
if (window.quavence) {
  // Request active address
  const [address] = await window.quavence.requestAccounts();
  console.log('Connected address:', address);

  // Sign verification message (Requires user approval popup)
  const { signature } = await window.quavence.signMessage('Verify ownership of ' + address);
  console.log('Cryptographic signature:', signature);

  // Claim PoUS Glyph artifact
  const result = await window.quavence.claimGlyph({
    dropId: 20,
    slotId: 3,
  });
  console.log('Claim Attestation:', result);
}
```

---

## License
This project is open-source under the [MIT License](LICENSE).
