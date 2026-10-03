import { NextResponse } from "next/server";
import { Keypair, contract } from "@stellar/stellar-sdk";

/**
 * Demo-mode actions, testnet only.
 *
 * The job screen's real path signs in the user's own wallet, which is right for
 * production and useless in a 3-minute video or on a judge's laptop. This route
 * performs the same contract calls with the repository's committed testnet keys
 * so the whole flow — deliver, dispute, adjudicate — can be exercised and
 * watched, with real transaction hashes on screen.
 *
 * It is refused outright on mainnet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["submit", "challenge", "confirm", "expire"]);

type SignTx = (tx: string) => Promise<{ signedTxXdr: string; error?: unknown }>;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`demo mode needs ${name}`);
  return v;
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") {
    return NextResponse.json(
      { error: "demo mode is disabled on mainnet" },
      { status: 403 },
    );
  }

  let body: { action?: string; id?: string; description?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { action, id } = body;
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json({ error: `action must be one of ${[...ACTIONS].join(", ")}` }, { status: 400 });
  }
  if (!id || !/^[0-9a-f]{64}$/i.test(id)) {
    return NextResponse.json({ error: "id must be 64 hex characters" }, { status: 400 });
  }

  try {
    const rpcUrl = need("NEXT_PUBLIC_RPC_TESTNET");
    const passphrase = "Test SDF Network ; September 2015";
    const contractId = need("NEXT_PUBLIC_CONTRACT_TESTNET");

    const client = Keypair.fromSecret(need("DEMO_CLIENT_SECRET"));
    const worker = Keypair.fromSecret(need("DEMO_WORKER_SECRET"));

    const idBytes = new Uint8Array(Buffer.from(id, "hex"));
    const sha = async (text: string) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

    const workerSigner = new contract.KeypairSigner(worker, passphrase);
    const clientSigner = new contract.KeypairSigner(client, passphrase);

    const c = (await contract.Client.from({
      contractId,
      rpcUrl,
      networkPassphrase: passphrase,
    })) as unknown as Record<
      string,
      (
        a: Record<string, unknown>,
        o: Record<string, unknown>,
      ) => Promise<{
        signAndSend: (o: Record<string, unknown>) => Promise<SentLike>;
        signAuthEntries: (o: Record<string, unknown>) => Promise<unknown>;
      }>
    >;

    let args: Record<string, unknown>;
    let signer: { address: string; signTransaction: SignTx };
    let label: string;

    if (action === "submit") {
      // The artifact is whatever text the caller names; its hash is what the
      // contract compares, exactly as a real file's hash would be.
      const description = String(body.description ?? "");
      if (!description) {
        return NextResponse.json({ error: "name the file you are delivering" }, { status: 400 });
      }
      args = { id: idBytes, artifact_hash: await sha(description) };
      signer = { address: worker.publicKey(), signTransaction: workerSigner.signTransaction };
      label = "Delivery";
    } else if (action === "challenge") {
      args = { id: idBytes, reason_hash: await sha(body.reason ?? "not what was agreed") };
      signer = { address: client.publicKey(), signTransaction: clientSigner.signTransaction };
      label = "Challenge";
    } else if (action === "confirm") {
      args = { id: idBytes };
      signer = { address: client.publicKey(), signTransaction: clientSigner.signTransaction };
      label = "Settlement";
    } else {
      args = { id: idBytes };
      signer = { address: client.publicKey(), signTransaction: clientSigner.signTransaction };
      label = "Sweep";
    }

    const tx = await c[action](args, {
      publicKey: signer.address,
      networkPassphrase: passphrase,
      signTransaction: signer.signTransaction,
    });
    const sent = await tx.signAndSend({
      signTransaction: signer.signTransaction,
    });

    const status = sent.getTransactionResponse?.status;
    if (status && status !== "SUCCESS") {
      return NextResponse.json(
        {
          error: refusal(status),
          refused: true,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      label,
      txHash: sent.getTransactionResponse?.hash ?? sent.sendTransactionResponse?.hash ?? null,
      signer: signer.address,
    });
  } catch (e) {
    // A failed simulation throws rather than returning a non-SUCCESS status,
    // and the SDK's message is a diagnostic dump. A refusal is the most
    // interesting thing this route can do, so it gets said in words.
    const raw = String((e as Error)?.message ?? e);
    const code = raw.match(/contract error"?\]*,?\s*(\d+)|Error\(Contract,\s*#(\d+)\)/);
    const n = code?.[1] ?? code?.[2];
    if (n) {
      return NextResponse.json({ error: refusal(`#${n}`), refused: true }, { status: 409 });
    }
    return NextResponse.json({ error: raw.slice(-300) }, { status: 500 });
  }
}

interface SentLike {
  getTransactionResponse?: { hash?: string; status?: string };
  sendTransactionResponse?: { hash?: string };
}

/** Turn a contract error code into the sentence a person would want to read. */
function refusal(status: string): string {
  const m = status.match(/#(\d+)/);
  switch (m?.[1]) {
    case "2":
      return "that job is not on chain yet";
    case "3":
      return "the contract refused: that job is not in a state that allows this. Released money cannot be reversed.";
    case "4":
      return "the dispute window has closed";
    case "5":
      return "this job is already closed";
    case "6":
      return "the delivery deadline has passed";
    default:
      return `the network rejected it: ${status}`;
  }
}
