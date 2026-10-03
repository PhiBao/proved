/**
 * Live chain driver for the Proved settlement primitive.
 *
 * This is the part that proves the product: every claim in the README and the
 * video is a transaction that actually landed. It runs the two paths a judge
 * will be shown — verified delivery, and a dispute — and prints the real hashes.
 *
 *   node scripts/demo.mjs --network testnet
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Operation,
  TransactionBuilder,
  contract,
  rpc,
} from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { getNetwork, networkName, ONE, fmt } from "./networks.mjs";
import { loadIdentities, testnetIdentities } from "./keys.mjs";
import { ensureFunded } from "./fund.mjs";
import { sacIdForAsset } from "./deploy.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sha256(thing) {
  return new Uint8Array(createHash("sha256").update(thing).digest());
}

/** A 32-byte BytesN from any string — our delivery "commitment". */
export function commitment(label) {
  return Buffer.from(sha256(label));
}

export class Proved {
  constructor({ net, contractId, keys }) {
    this.net = net;
    this.contractId = contractId;
    this.keys = keys;
    this.server = new rpc.Server(net.rpcUrl);
    this.horizon = new Horizon.Server(net.horizonUrl);
    this._client = null;
  }

  async client() {
    if (!this._client) {
      this._client = await contract.Client.from({
        contractId: this.contractId,
        rpcUrl: this.net.rpcUrl,
        networkPassphrase: this.net.passphrase,
      });
    }
    return this._client;
  }

  /** Read-only call. Args are named, matching the contract's parameter names. */
  async read(method, args = {}) {
    const c = await this.client();
    const { result } = await c[method](args, {
      publicKey: this.keys.observer.publicKey(),
    });
    return result;
  }

  /**
   * State-changing call.
   *
   * `invoker` submits the transaction; `coSigners` authorise alongside. That
   * two-party authorisation is the point: neither side can fund or settle a job
   * alone.
   */
  async write(method, args, invoker, coSigners = []) {
    const c = await this.client();
    const signer = (kp) => new contract.KeypairSigner(kp, this.net.passphrase);

    // Only the invoker's envelope signer is supplied here. Supplying
    // `signAuthEntry` up front would eagerly sign every party's auth entry,
    // leaving the co-signers nothing to add.
    const tx = await c[method](args, {
      publicKey: invoker.publicKey(),
      networkPassphrase: this.net.passphrase,
      signTransaction: signer(invoker).signTransaction,
    });

    for (const kp of coSigners) {
      await tx.signAuthEntries({ ...signer(kp), forAddress: kp.publicKey() });
    }

    const sent = await tx.signAndSend({ ...signer(invoker) });
    const hash = txHashOf(sent);
    const res = sent.getTransactionResponse;
    if (res && res.status !== "SUCCESS") {
      throw new Error(
        `${method} failed on chain: ${res.status} ${res.resultDiagnosticCodes ?? ""}`,
      );
    }
    return { hash, result: sent.result };
  }

  /** Contract events, newest first. */
  async events(jobId, limit = 10) {
    const c = commitment(jobId);
    const idHex = Buffer.from(c).toString("hex");
    const res = await this.server.getEvents({
      startLedger: this._startLedger ?? 0,
      filters: [{ type: "contract", contractIds: [this.contractId] }],
      pagination: { limit: 200 },
    });
    return (res.events ?? []).filter(
      (e) =>
        e.topic?.some(
          (t) => Buffer.from(t, "base64").toString("hex").endsWith(idHex),
        ),
    );
  }

  async setStartLedger() {
    const l = await this.server.getLatestLedger();
    this._startLedger = l.sequence;
    return l.sequence;
  }
}

// -------------------------------------------------------- classic plumbing ---

/** Open a trustline for the settlement asset and submit it. */
export async function ensureTrustline(net, holderKp, assetCode, issuerKp) {
  const asset = new Asset(assetCode, issuerKp.publicKey());
  const res = await fetch(`${net.horizonUrl}/accounts/${holderKp.publicKey()}`);
  if (!res.ok) throw new Error(`account ${holderKp.publicKey()} not found on horizon`);
  const acct = await res.json();
  const has = acct.balances?.some(
    (b) => b.asset_code === assetCode && b.asset_issuer === issuerKp.publicKey(),
  );
  if (has) return false;

  const server = new Horizon.Server(net.horizonUrl);
  const source = new Account(acct.id, acct.sequence);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: net.passphrase,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  tx.sign(holderKp);
  await server.submitTransaction(tx);
  await sleep(1500);
  return true;
}

/** Mint settlement asset straight to a holder via the SAC contract. */
export async function mint(net, sacId, issuerKp, toKp, amount) {
  const client = await contract.Client.from({
    contractId: sacId,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.passphrase,
  });
  const signer = new contract.KeypairSigner(issuerKp, net.passphrase);
  const tx = await client.mint({ to: toKp.publicKey(), amount: String(amount) }, {
    publicKey: issuerKp.publicKey(),
    networkPassphrase: net.passphrase,
    ...signer,
  });
  const sent = await tx.signAndSend(signer);
  const hash = txHashOf(sent);
  const res = sent.getTransactionResponse;
  if (res && res.status !== "SUCCESS") {
    throw new Error(`mint failed on chain: ${res.status} ${res.resultDiagnosticCodes ?? ""}`);
  }
  return hash;
}

/** The hash of a submitted transaction, across SDK response shapes. */
export function txHashOf(sent) {
  return (
    sent?.getTransactionResponse?.hash ??
    sent?.sendTransactionResponse?.hash ??
    sent?.hash ??
    sent?.transactionHash
  );
}

/** Asset precision, straight from the token contract. */
export async function decimalsOf(net, sacId) {
  const client = await contract.Client.from({
    contractId: sacId,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.passphrase,
  });
  const { result } = await client.decimals([], { publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });
  return Number(result);
}

/** Read a token balance straight from the SAC. */
export async function tokenBalance(net, sacId, accountPub) {
  const client = await contract.Client.from({
    contractId: sacId,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.passphrase,
  });
  const { result } = await client.balance({ id: accountPub }, {
    publicKey: accountPub,
  });
  return result;
}

export { ONE, fmt, Address, sleep };
