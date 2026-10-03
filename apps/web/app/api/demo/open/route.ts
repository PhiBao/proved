import { NextResponse } from "next/server";
import { Keypair, contract } from "@stellar/stellar-sdk";

/**
 * Demo-mode job creation, testnet only.
 *
 * Opening a job needs two signatures, and one browser cannot produce both. On
 * testnet this route signs with the repository's committed testnet keys — they
 * are derived from public hard-coded seeds, hold no value, and being committed
 * is what lets anyone reproduce the demo without installing a wallet.
 *
 * The keys arrive as env vars so the same code runs locally and on a serverless
 * host; nothing is read from the filesystem, because a deployed function has no
 * repository. On mainnet the route refuses outright.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The SDK's signer callback shapes. They return an object rather than a bare
 * string, and may carry a wallet `error`, so they are typed here rather than
 * being forced into a narrower signature.
 */
type SignTx = (tx: string) => Promise<{ signedTxXdr: string; error?: unknown }>;
type SignAuth = (entry: string) => Promise<{ signedAuthEntry: string; error?: unknown }>;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`demo mode needs ${name}`);
  return v;
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") {
    return NextResponse.json(
      { error: "the demo custodian is disabled on mainnet — fund with a real wallet" },
      { status: 403 },
    );
  }

  let body: { description?: string; amount?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const description = String(body.description ?? "").trim();
  const amount = Number(body.amount);

  if (!description) {
    return NextResponse.json({ error: "describe the deliverable" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "amount out of range" }, { status: 400 });
  }

  try {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_TESTNET!;
    const passphrase = "Test SDF Network ; September 2015";
    const contractId = need("NEXT_PUBLIC_CONTRACT_TESTNET");
    const asset = need("NEXT_PUBLIC_ASSET_CONTRACT_TESTNET");

    const client = Keypair.fromSecret(need("DEMO_CLIENT_SECRET"));
    const worker = Keypair.fromSecret(need("DEMO_WORKER_SECRET"));

    // Read the asset's own precision rather than assuming 6, so a self-minted
    // 7-decimal testnet asset and 6-decimal USDC both behave.
    const sac = await contract.Client.from({
      contractId: asset,
      rpcUrl,
      networkPassphrase: passphrase,
    });
    // The SAC's generated methods are not in the SDK's base Client type.
    const sacCall = (sac as unknown as Record<string, unknown>).decimals as (
      a: unknown[],
      o: { publicKey: string },
    ) => Promise<{ result: number }>;
    const { result: decimals } = await sacCall([], { publicKey: client.publicKey() });
    const amountRaw = BigInt(Math.round(amount * 10 ** Number(decimals)));

    const id = crypto.getRandomValues(new Uint8Array(32));
    const condition = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(description)),
    );

    const c = await contract.Client.from({ contractId, rpcUrl, networkPassphrase: passphrase });
    // v17 removed Keypair.signTransaction; KeypairSigner is the supported way.
    const signClient = new contract.KeypairSigner(client, passphrase);
    const signWorker = new contract.KeypairSigner(worker, passphrase);

    const openCall = (c as unknown as Record<string, unknown>).open as (
      a: Record<string, unknown>,
      o: { publicKey: string; networkPassphrase: string; signTransaction: SignTx },
    ) => Promise<{
      signAndSend: (o: { signTransaction: SignTx }) => Promise<{
        getTransactionResponse?: { hash?: string; status?: string };
        sendTransactionResponse?: { hash?: string };
      }>;
      signAuthEntries: (o: {
        signAuthEntry: SignAuth;
        // The runtime destructures `address`; `forAddress` is only for
        // delegates via authorizeEntry.
        address: string;
      }) => Promise<unknown>;
    }>;

    const tx = await openCall(
      {
        id,
        freelancer: worker.publicKey(),
        client: client.publicKey(),
        amount: amountRaw,
        condition_hash: condition,
        deliver_by: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      },
      { publicKey: client.publicKey(), networkPassphrase: passphrase, signTransaction: signClient.signTransaction },
    );
    // Second signature: the worker accepting terms and locking their stake.
    await tx.signAuthEntries({
      signAuthEntry: signWorker.signAuthEntry,
      // Explicit, because we destructure the signer and lose the `address` the
      // SDK would otherwise read off it. `forAddress` is for delegates only.
      address: worker.publicKey(),
    });
    const sent = await tx.signAndSend(signClient);

    const status = sent.getTransactionResponse?.status;
    if (status && status !== "SUCCESS") {
      return NextResponse.json({ error: `the network rejected it: ${status}` }, { status: 502 });
    }

    const hex = (u: Uint8Array) =>
      [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
    return NextResponse.json({
      jobId: hex(id),
      conditionHex: hex(condition),
      txHash:
        sent.getTransactionResponse?.hash ?? sent.sendTransactionResponse?.hash ?? null,
      worker: worker.publicKey(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: String((e as Error)?.message ?? e).slice(-400) },
      { status: 500 },
    );
  }
}