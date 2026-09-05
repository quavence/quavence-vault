export const NETWORK = {
  NAME: 'Quavence Mainnet',
  TICKER: 'QVNC',
  DECIMALS: 8,
  PUBKEY_VERSION: 0x3f, // 63 -> generates 'S...' addresses in Base58Check
  SCRIPT_VERSION: 0x7d, // 125 -> generates 's...' script addresses
  WIF_VERSION: 0xc1, // 193 -> WIF private key prefix
  SIGN_MAGIC: 'BlackCoin Signed Message:\n', // Exact magic from node main.cpp
  COIN_TYPE: 9999, // BIP-44 coin type for Quavence
  DERIVATION_PATH: "m/44'/9999'/0'/0",
  DEFAULT_EXPLORER_URL: 'https://explorer.quavence.com',
  DEFAULT_DAO_URL: 'https://quavence.com',
} as const;

export const VAULT_SECURITY = {
  PBKDF2_ITERATIONS: 210000, // OWASP recommendation
  AUTO_LOCK_TIMEOUT_MS: 15 * 60 * 1000, // 15 minutes
} as const;
