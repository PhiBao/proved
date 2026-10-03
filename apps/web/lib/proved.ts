/**
 * Everything the UI needs to talk to the Proved contract.
 *
 * Reads happen server-side through simulation. Writes are signed by the user's
 * own wallet, so the app never holds a key — with one deliberate exception, the
 * demo custodian, which exists so a judge can click through without installing
 * anything and can be disabled with `NEXT_PUBLIC_DEMO_MODE=off`.
 */
import { contract, rpc } from "@stellar/stellar-sdk";
import type { ClientConfig, JobState } from "./client-config";

export type { ClientConfig, JobState };
export { STATE_LABEL } from "./client-config";

export type Network = "testnet" | "mainnet";

export interface NetConfig {
  label: string;
  rpcUrl: string;
  passphrase: string;
  explorerTx: (h: string) => string;
  explorerAccount: (a: string) => string;
  explorerContract: (a: string) => string;
  assetCode: string;
  assetContract: string;
}

export function networkConfig(n: Network): NetConfig {
  if (n === "mainnet") {
    return {
      label: "Stellar mainnet",
      rpcUrl: requiredEnv("NEXT_PUBLIC_RPC_MAINNET", "mainnet Soroban RPC"),
      passphrase: "Public Global Stellar Network ; September 2015",
      explorerTx: (h) => `https://stellar.expert/explorer/mainnet/tx/${h}`,
      explorerAccount: (a) => `https://stellar.expert/explorer/mainnet/account/${a}`,
      explorerContract: (a) => `https://stellar.expert/explorer/mainnet/contract/${a}`,
      assetCode: "USDC",
      assetContract: requiredEnv("NEXT_PUBLIC_USDC_MAINNET", "mainnet USDC contract"),
    };
  }
  return {
    label: "Stellar testnet",
    rpcUrl:
      process.env.NEXT_PUBLIC_RPC_TESTNET ??
      "https://radial-dry-wildflower.stellar-testnet.quiknode.pro/e73cf7dee3cdd362a7eaa06654244b500ae514c2/",
    passphrase: "Test SDF Network ; September 2015",
    explorerTx: (h) => `https://stellar.expert/explorer/testnet/tx/${h}`,
    explorerAccount: (a) => `https://stellar.expert/explorer/testnet/account/${a}`,
    explorerContract: (a) => `https://stellar.expert/explorer/testnet/contract/${a}`,
    assetCode: process.env.NEXT_PUBLIC_ASSET_CODE_TESTNET ?? "PUSD",
    assetContract: process.env.NEXT_PUBLIC_ASSET_CONTRACT_TESTNET ?? "",
  };
}

function requiredEnv(name: string, what: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${what} not configured: set ${name}`);
  return v;
}

export function contractId(n: Network): string {
  return requiredEnv(
    n === "mainnet" ? "NEXT_PUBLIC_CONTRACT_MAINNET" : "NEXT_PUBLIC_CONTRACT_TESTNET",
    "contract id",
  );
}

export function networkFromEnv(): Network {
  return process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

/** Upwork's flat arbitration fee, in whole units. The number we exist to beat. */
export const UPWORK_FLAT_FEE_USD = 337n;

/** A client's browser wallet. Kept to the two methods we actually use. */
export interface Wallet {
  publicKey: string;
  signTransaction: (tx: string) => Promise<string>;
  signAuthEntry?: (entry: string) => Promise<string>;
}

/** Options every generated method accepts. */
export interface CallOpts {
  publicKey: string;
  signTransaction?: Wallet["signTransaction"];
  networkPassphrase?: string;
}

export interface CallResult<T> {
  result: T;
}

/**
 * The contract's methods, typed. `stellar contract bindings typescript` would
 * generate this from the deployed spec; declaring it keeps the app buildable
 * without a codegen step and doubles as documentation of the read/write surface.
 */
export interface ProvedContract {
  token(opts: CallOpts): Promise<CallResult<string>>;
  decimals(opts: CallOpts): Promise<CallResult<number>>;
  job(args: { id: Uint8Array }, opts: CallOpts): Promise<CallResult<JobView | null>>;
  state(args: { id: Uint8Array }, opts: CallOpts): Promise<CallResult<number>>;
  is_final(args: { id: Uint8Array }, opts: CallOpts): Promise<CallResult<boolean>>;
  attestation(
    args: { id: Uint8Array },
    opts: CallOpts,
  ): Promise<CallResult<[string, string, boolean, number]>>;
  reputation(args: { who: string }, opts: CallOpts): Promise<CallResult<[number, number, number, number]>>;
  stake_bps(args: { freelancer: string }, opts: CallOpts): Promise<CallResult<number>>;
  stake_for(args: { freelancer: string; amount: string | bigint }, opts: CallOpts): Promise<CallResult<string>>;
  challenge_bond_for(args: { amount: string | bigint }, opts: CallOpts): Promise<CallResult<string>>;

  open(
    args: {
      id: Uint8Array;
      freelancer: string;
      client: string;
      amount: string | bigint;
      condition_hash: string;
      deliver_by: number;
    },
    opts: CallOpts,
  ): Promise<{ result: undefined; signAndSend: (o: CallOpts) => Promise<SentLike> }>;
  submit(
    args: { id: Uint8Array; artifact_hash: Uint8Array },
    opts: CallOpts,
  ): Promise<{ result: undefined; signAndSend: (o: CallOpts) => Promise<SentLike> }>;
  challenge(
    args: { id: Uint8Array; reason_hash: Uint8Array },
    opts: CallOpts,
  ): Promise<{ result: undefined; signAndSend: (o: CallOpts) => Promise<SentLike> }>;
  confirm(
    args: { id: Uint8Array },
    opts: CallOpts,
  ): Promise<{ result: undefined; signAndSend: (o: CallOpts) => Promise<SentLike> }>;
  expire(
    args: { id: Uint8Array },
    opts: CallOpts,
  ): Promise<{ result: undefined; signAndSend: (o: CallOpts) => Promise<SentLike> }>;
}

export interface SentLike {
  getTransactionResponse?: { hash?: string; status?: string };
  sendTransactionResponse?: { hash?: string };
}

export type ProvedClient = contract.Client & ProvedContract;

export async function getClient(n: Network): Promise<ProvedClient> {
  return (await contract.Client.from({
    contractId: contractId(n),
    rpcUrl: networkConfig(n).rpcUrl,
    networkPassphrase: networkConfig(n).passphrase,
  })) as ProvedClient;
}

/** Any address works as the "source" for a read; nothing is signed. */
const READ_AS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * A job id as the contract wants it: `BytesN<32>` is a 32-byte value, so a hex
 * string has to be decoded. Passing the hex string straight through silently
 * produces a malformed ScVal and the call fails in the VM, which is a confusing
 * way to learn this.
 */
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

export async function read<T = unknown>(
  n: Network,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const c = await getClient(n);
  const fn = (c as unknown as Record<string, unknown>)[method] as (
    a: Record<string, unknown>,
    o: CallOpts,
  ) => Promise<CallResult<T>>;
  const { result } = await fn(args, { publicKey: READ_AS });
  return result;
}

export interface JobView {
  freelancer: string;
  client: string;
  amount: string;
  condition_hash: string;
  artifact_hash: string | null;
  reason_hash: string | null;
  stake: string;
  challenge_bond: string;
  deliver_by: string;
  opened_at: string;
  state: number;
}

/** Read a job plus the derived numbers a person actually wants to see. */
export async function loadJob(n: Network, id: string) {
  const jid = jobIdArg(id);
  const [job, state, isFinal, decimals] = await Promise.all([
    read<JobView | null>(n, "job", { id: jid }).catch(() => null),
    read<number>(n, "state", { id: jid }).catch(() => 0),
    read<boolean>(n, "is_final", { id: jid }).catch(() => false),
    read<number>(n, "decimals", {}).catch(() => 6),
  ]);
  return { job, state: state as JobState, isFinal, decimals };
}

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

/** SHA-256 of a string, as bytes. The contract compares `BytesN<32>`. */
export async function sha256Bytes(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** SHA-256 of a string, hex. Matches what the scripts print. */
export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256Bytes(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}


export { contract, rpc };

/**
 * Build the config the browser needs, here on the server where the environment
 * actually exists. Throws at render time if something is missing, which turns a
 * misconfiguration into a build error instead of a blank card in production.
 */
/** Explorer URL bases, without the functions. */
function explorerBase(n: Network) {
  const cfg = networkConfig(n);
  return {
    tx: cfg.explorerTx(""),
    account: cfg.explorerAccount(""),
    contract: cfg.explorerContract(""),
  };
}

export function clientConfig(): ClientConfig {
  return {
    network: networkFromEnv(),
    contractId: contractId(networkFromEnv()),
    rpcUrl: networkConfig(networkFromEnv()).rpcUrl,
    passphrase: networkConfig(networkFromEnv()).passphrase,
    assetCode: networkConfig(networkFromEnv()).assetCode,
    assetContract: networkConfig(networkFromEnv()).assetContract,
    explorerTxBase: explorerBase(networkFromEnv()).tx,
    explorerAccountBase: explorerBase(networkFromEnv()).account,
    explorerContractBase: explorerBase(networkFromEnv()).contract,
  };
}
