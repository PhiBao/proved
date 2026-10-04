/**
 * Everything the browser needs to talk to the contract.
 *
 * `NEXT_PUBLIC_*` variables are inlined at build time, which makes a
 * client-side `process.env` lookup a deployment foot-gun: the value silently
 * disappears from the bundle and fails at runtime instead of at build. So the
 * server reads the environment once and hands the client this object through
 * props. One source of truth, and a misconfiguration becomes a build error
 * rather than a blank card.
 */
/**
 * The contract's methods, typed. `stellar contract bindings typescript` would
 * generate this from the deployed spec; declaring it keeps the app buildable
 * without a codegen step and doubles as documentation of the read surface.
 * The index signature keeps dynamic access (`c[method]`) typed.
 */
export interface ProvedContract {
  [method: string]: unknown;
  decimals(opts: { publicKey: string }): Promise<{ result: number }>;
  stake_bps(
    args: { freelancer: string },
    opts: { publicKey: string },
  ): Promise<{ result: string }>;
  token(opts: { publicKey: string }): Promise<{ result: string }>;
  attestation(
    args: { id: Uint8Array },
    opts: { publicKey: string },
  ): Promise<{ result: [string, string, boolean, number] | null }>;
  state(args: { id: Uint8Array }, opts: { publicKey: string }): Promise<{ result: number }>;
  challenge_bond_for(
    args: { amount: string | bigint },
    opts: { publicKey: string },
  ): Promise<{ result: string }>;
}

export type ProvedClient = ProvedContract & {
  job(args: { id: Uint8Array }, opts: { publicKey: string }): Promise<{ result: unknown }>;
  state(args: { id: Uint8Array }, opts: { publicKey: string }): Promise<{ result: number }>;
  is_final(args: { id: Uint8Array }, opts: { publicKey: string }): Promise<{ result: boolean }>;
};

/**
 * Pure data, on purpose: React Server Components cannot pass functions to a
 * client component, so explorer URLs are base strings and the link builders
 * below are defined here, on the client side of the boundary.
 */
export interface ClientConfig {
  network: "testnet" | "mainnet";
  contractId: string;
  rpcUrl: string;
  passphrase: string;
  assetCode: string;
  assetContract: string;
  explorerTxBase: string;
  explorerAccountBase: string;
  explorerContractBase: string;
  /**
   * Why this network could not be configured, when it could not.
   *
   * Present so a deployment missing the mainnet RPC or USDC variables still
   * builds and can explain itself, instead of failing at build time or rendering
   * a network switcher whose mainnet option silently does nothing.
   */
  unconfigured?: string;
}

export const explorerTx = (cfg: ClientConfig, hash: string) => cfg.explorerTxBase + hash;
export const explorerAccount = (cfg: ClientConfig, addr: string) => cfg.explorerAccountBase + addr;
export const explorerContract = (cfg: ClientConfig, addr: string) =>
  cfg.explorerContractBase + addr;

/**
 * Build a contract client from an explicit config. Isomorphic on purpose: the
 * same call works in a server component and in the browser, which is the point
 * of passing the config down rather than reading env on the client.
 */
export async function getClientFor(cfg: ClientConfig): Promise<ProvedClient> {
  const { contract } = await import("@stellar/stellar-sdk");
  return (await contract.Client.from({
    contractId: cfg.contractId,
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.passphrase,
  })) as ProvedClient;
}

/** Any address works as the "source" for a read; nothing is signed. */
export const READ_AS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Job lifecycle, as the contract reports it. */
export type JobState = 0 | 1 | 2 | 3 | 4;

export const STATE_LABEL: Record<JobState, string> = {
  0: "not found",
  1: "awaiting delivery",
  2: "paid",
  3: "disputed",
  4: "settled",
};

/** Format an amount held in the asset's smallest denomination. */
export function money(amount: string | bigint | number, decimals: number, dp = 2): string {
  const unit = 10n ** BigInt(decimals);
  const v = BigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole}${dp ? `.${frac}` : ""}`;
}

/** A job id as the contract wants it: `BytesN<32>` is a 32-byte value. */
export function jobIdArg(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`not a job id: expected 64 hex characters, got "${hex.slice(0, 20)}…"`);
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
}

/** Normalise a job id coming out of a route param. */
export function normaliseJobId(raw: string): string {
  return raw.startsWith("0x") ? raw.slice(2) : raw;
}

/** SHA-256 of a string, as bytes. The contract compares `BytesN<32>`. */
export async function sha256Bytes(input: string | ArrayBuffer): Promise<Uint8Array> {
  // Text is encoded on the caller's behalf; raw bytes are passed through, because
  // encoding a file's bytes as text would corrupt them and quietly break
  // byte-for-byte comparison for anything that is not valid UTF-8.
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** SHA-256 of a string, hex. Matches what the scripts print. */
/**
 * SHA-256 of raw bytes, hex.
 *
 * Takes an ArrayBuffer rather than a File so this stays isomorphic and testable
 * off a browser. Hashing a file's decoded text is not equivalent — it replaces
 * anything that is not valid UTF-8, so two different files can collide, and a
 * delivered binary would never match the payer's copy.
 */
export async function sha256Of(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256Bytes(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}