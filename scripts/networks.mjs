/**
 * Network configuration, read from the environment.
 *
 * Everything that differs between a throwaway testnet run and a real mainnet
 * deployment lives here, so the demo scripts and the app never hard-code an
 * endpoint. `.env.example` documents the variables.
 */

export const NETWORKS = {
  testnet: {
    label: "Testnet",
    passphrase: "Test SDF Network ; September 2015",
    // Public, no key required.
    rpcUrl:
      process.env.STELLAR_RPC_TESTNET ??
      "https://radial-dry-wildflower.stellar-testnet.quiknode.pro/e73cf7dee3cdd362a7eaa06654244b500ae514c2/",
    horizonUrl: process.env.STELLAR_HORIZON_TESTNET ?? "https://horizon-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    explorerTx: (h) => `https://stellar.expert/explorer/testnet/tx/${h}`,
    explorerContract: (a) => `https://stellar.expert/explorer/testnet/contract/${a}`,
    explorerAccount: (a) => `https://stellar.expert/explorer/testnet/account/${a}`,
    // Native USDC on Stellar testnet is a Stellar Asset Contract.
    usdc:
      process.env.STELLAR_USDC_TESTNET ??
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    usdcIssuer:
      process.env.STELLAR_USDC_ISSUER_TESTNET ??
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  mainnet: {
    label: "Mainnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    // Mainnet Soroban RPC is not free-public; bring your own provider.
    rpcUrl: process.env.STELLAR_RPC_MAINNET ?? "",
    horizonUrl: process.env.STELLAR_HORIZON_MAINNET ?? "https://horizon.stellar.org",
    friendbotUrl: null,
    explorerTx: (h) => `https://stellar.expert/explorer/mainnet/tx/${h}`,
    explorerContract: (a) => `https://stellar.expert/explorer/mainnet/contract/${a}`,
    explorerAccount: (a) => `https://stellar.expert/explorer/mainnet/account/${a}`,
    // Circle-issued USDC on Stellar mainnet, also a Stellar Asset Contract.
    usdc:
      process.env.STELLAR_USDC_MAINNET ??
      "CC6X0XMG5MUK5YXQZSR2F2Z4T2DRU4IAOFOJNHQ2KAC7BTTH2AMPW4C2Z",
    usdcIssuer:
      process.env.STELLAR_USDC_ISSUER_MAINNET ??
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
};

export function networkName(argv = process.argv) {
  const i = argv.indexOf("--network");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return process.env.STELLAR_NETWORK ?? "testnet";
}

export function getNetwork(name) {
  const n = NETWORKS[name];
  if (!n) {
    throw new Error(
      `unknown network "${name}" (expected one of: ${Object.keys(NETWORKS).join(", ")})`,
    );
  }
  if (name === "mainnet" && !n.rpcUrl) {
    throw new Error(
      "mainnet Soroban RPC is not public. Set STELLAR_RPC_MAINNET to a provider " +
        "endpoint (QuickNode, Alchemy, Ankr, Validation Cloud, Chainstack...).",
    );
  }
  return n;
}

/** Base unit for a 6-decimal asset. */
export const ONE = 1_000_000;

/**
 * Format an amount in the asset's smallest denomination as a decimal string,
 * without floating point. `decimals` must match the asset: USDC is 6, and a
 * classic Stellar asset is always 7.
 */
export function fmt(amount, decimals = 6, dp = 2) {
  const unit = 10n ** BigInt(decimals);
  const v = BigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole}${dp ? `.${frac}` : ""}`;
}
