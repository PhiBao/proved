"use client";

/**
 * The job screen: one page, two roles, and a live cost curve.
 *
 * Everything a person is asked to do here is one click plus their wallet
 * signature. There is no approve button anywhere, deliberately — the whole
 * product is the absence of one.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getClient,
  jobIdArg,
  money,
  networkConfig,
  networkFromEnv,
  sha256Bytes,
  type JobState,
  type Wallet,
} from "@/lib/proved";

type Job = {
  freelancer: string;
  client: string;
  amount: string;
  condition_hash: string;
  artifact_hash: string | null;
  reason_hash: string | null;
  stake: string;
  challenge_bond: string;
  deliver_by: string;
  state: number;
};

interface Props {
  jobId: string;
  role: "client" | "freelancer";
  initial: { job: Job | null; state: JobState; decimals: number };
}

const STATUS: Record<JobState, { label: string; cls: string }> = {
  0: { label: "not found", cls: "pill-open" },
  1: { label: "awaiting delivery", cls: "pill-open" },
  2: { label: "paid", cls: "pill-paid" },
  3: { label: "disputed", cls: "pill-disputed" },
  4: { label: "settled", cls: "pill-open" },
};

/** A wallet provider that follows the standard Stellar browser interface. */
declare global {
  interface Window {
    freighter?: {
      signTransaction: (tx: string, opts?: object) => Promise<string>;
      getPublicKey: () => Promise<string>;
    };
  }
}

export default function JobPanel({ jobId, role, initial }: Props) {
  const net = networkConfig(networkFromEnv());
  const [job, setJob] = useState<Job | null>(initial.job);
  const [state, setState] = useState<JobState>(initial.state);
  const [decimals, setDecimals] = useState(initial.decimals);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  /** Poll chain state, so the screen is never stale and never trusts the server. */
  const refresh = useCallback(async () => {
    try {
      const c = await getClient(networkFromEnv());
      const as = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const [j, s] = await Promise.all([
        c.job({ id: jobIdArg(jobId) }, { publicKey: as }),
        c.state({ id: jobIdArg(jobId) }, { publicKey: as }),
      ]);
      setJob((j.result as Job | null) ?? null);
      setState(s.result as JobState);
    } catch {
      /* leave the last known state on screen */
    }
  }, [jobId, net.rpcUrl, net.passphrase]);

  useEffect(() => {
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function connect(): Promise<Wallet | null> {
    if (!window.freighter) {
      setNote({
        kind: "bad",
        text: "No browser wallet found. Install Freighter for testnet, or open a job from /j/new in demo mode.",
      });
      return null;
    }
    const publicKey = await window.freighter.getPublicKey();
    setAddress(publicKey);
    return {
      publicKey,
      signTransaction: (tx: string) => window.freighter!.signTransaction(tx, { alwaysPrompt: false }),
    };
  }

  /** Run a contract method: build, sign, send, then show the real tx hash. */
  async function act(method: string, args: Record<string, unknown>, label: string) {
    setBusy(method);
    setNote(null);
    try {
      const wallet = await connect();
      if (!wallet) return;

      const c = await getClient(networkFromEnv());

      const tx = await (
        c as unknown as Record<
          string,
          (a: Record<string, unknown>, o: Record<string, unknown>) => Promise<{
            signAndSend: (o: Record<string, unknown>) => Promise<{
              getTransactionResponse?: { hash?: string; status?: string };
              sendTransactionResponse?: { hash?: string };
            }>;
          }>
        >
      )[method](args, {
        publicKey: wallet.publicKey,
        networkPassphrase: net.passphrase,
        signTransaction: wallet.signTransaction,
      });
      const sent = await tx.signAndSend({ signTransaction: wallet.signTransaction });
      const status = sent.getTransactionResponse?.status;
      if (status && status !== "SUCCESS") {
        throw new Error(`the network rejected it: ${status}`);
      }
      setTxHash(
        sent.getTransactionResponse?.hash ?? sent.sendTransactionResponse?.hash ?? null,
      );
      setNote({ kind: "ok", text: `${label} confirmed on chain` });
      await refresh();
    } catch (e) {
      setNote({ kind: "bad", text: shortError(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!job) {
    return (
      <div className="card">
        <p className="label mb-2">Job</p>
        <p className="mono text-sm break-all">{jobId}</p>
        <p className="mt-3 text-sm" style={{ color: "var(--ink-soft)" }}>
          Not on chain yet. If you just created it, give the network a few seconds.
        </p>
      </div>
    );
  }

  const isClient = role === "client";
  const you = isClient ? job.client : job.freelancer;
  const status = STATUS[state];
  const stake = BigInt(job.stake);
  const bond = BigInt(job.challenge_bond);
  const youAreParty = address === you;
  const wrongParty =
    address !== null && !youAreParty
      ? isClient
        ? "You are connected as the freelancer, not the payer."
        : "You are connected as the payer, not the worker."
      : null;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- status -- */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className={`pill ${status.cls}`}>{status.label}</span>
          <span className="mono text-sm" style={{ color: "var(--ink-soft)" }}>
            {money(job.amount, decimals)} {net.assetCode}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div>
            <dt className="label">payer</dt>
            <dd className="mono truncate" title={job.client}>
              {job.client.slice(0, 8)}…
            </dd>
          </div>
          <div>
            <dt className="label">worker</dt>
            <dd className="mono truncate" title={job.freelancer}>
              {job.freelancer.slice(0, 8)}…
            </dd>
          </div>
          <div>
            <dt className="label">worker&apos;s stake</dt>
            <dd className="mono">{money(stake, decimals)}</dd>
          </div>
          <div>
            <dt className="label">dispute bond</dt>
            <dd className="mono">{bond > 0n ? money(bond, decimals) : "—"}</dd>
          </div>
        </dl>

        {state === 2 && (
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--accent)" }}>
            Paid, and <strong>not reversible</strong>. This job cannot be challenged, re-submitted,
            or expired — the contract will refuse all three.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------- cost curve -- */}
      <div className="card">
        <p className="label mb-2">What a dispute costs here</p>
        <div className="flex items-baseline gap-3">
          <span className="mono text-2xl font-bold" style={{ color: "var(--accent)" }}>
            {money(bond > 0n ? bond : 0n, decimals)}
          </span>
          <span className="text-sm" style={{ color: "var(--ink-soft)" }}>
            0.15% of the job
          </span>
        </div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--ink-soft)" }}>
          Upwork: <span className="mono">$337.50</span> flat, for anyone, at any amount.
        </p>
      </div>

      {/* --------------------------------------------------------- actions -- */}
      <div className="card space-y-3">
        <p className="label">You are the {isClient ? "payer" : "worker"}</p>

        {address && (
          <p className="mono text-[13px]" style={{ color: "var(--ink-soft)" }}>
            {address.slice(0, 8)}… {youAreParty ? "" : `— ${wrongParty}`}
          </p>
        )}

        {!isClient && state === 1 && (
          <>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              Delivering checks your file against the commitment the payer signed when they funded
              the job. If it matches, you are paid in this transaction.
            </p>
            <DeliverButton
              busy={busy === "submit"}
              disabled={busy !== null || address !== null && !youAreParty}
              onDeliver={(digest) =>
                act(
                  "submit",
                  { id: jobIdArg(jobId), artifact_hash: digest },
                  "Delivery",
                )
              }
            />
          </>
        )}

        {!isClient && state === 3 && (
          <>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              A dispute is open. Deliver now — if your artifact matches, the contract releases your
              money and slashes their bond immediately.
            </p>
            <DeliverButton
              busy={busy === "submit"}
              disabled={busy !== null || (address !== null && !youAreParty)}
              onDeliver={(digest) =>
                act("submit", { id: jobIdArg(jobId), artifact_hash: digest }, "Delivery")
              }
            />
          </>
        )}

        {isClient && state === 1 && (
          <>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              Something wrong? Contesting costs{" "}
              <strong className="mono" style={{ color: "var(--ink)" }}>
                {money((BigInt(job.amount) * 15n) / 10_000n < 10n ** BigInt(decimals)
                  ? 10n ** BigInt(decimals)
                  : (BigInt(job.amount) * 15n) / 10_000n, decimals)}
              </strong>
              , posted to the worker if the work turns out to be fine.
            </p>
            <button
              className="btn btn-ghost w-full"
              disabled={busy !== null || (address !== null && !youAreParty)}
              onClick={async () =>
                act(
                  "challenge",
                  { id: jobIdArg(jobId), reason_hash: await sha256Bytes("disputed-by-payer") },
                  "Challenge",
                )
              }
            >
              {busy === "challenge" ? "Confirm in wallet…" : "Something’s wrong"}
            </button>
          </>
        )}

        {isClient && state === 3 && (
          <>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              Ask the contract to settle it. It compares what was delivered against what you
              committed to when you paid. No human decides this.
            </p>
            <button
              className="btn btn-primary w-full"
              disabled={busy !== null || (address !== null && !youAreParty)}
              onClick={() => act("confirm", { id: jobIdArg(jobId) }, "Settlement")}
            >
              {busy === "confirm" ? "Confirm in wallet…" : "Settle it on chain"}
            </button>
          </>
        )}

        {(state === 2 || state === 4) && (
          <p className="text-[13px]" style={{ color: "var(--ink-soft)" }}>
            Closed.{" "}
            <a className="link" href={`/proof/${jobId}`}>
              Open the portable proof
            </a>{" "}
            — it renders from chain state, with no account and no server.
          </p>
        )}

        {state === 0 && <p className="text-[13px]">Nothing here yet.</p>}
      </div>

      {/* ------------------------------------------------------------ note -- */}
      {note && (
        <div
          className="card text-[13px]"
          style={{
            borderColor: note.kind === "ok" ? "var(--accent)" : "var(--warn)",
            background: note.kind === "ok" ? "var(--accent-soft)" : "var(--warn-soft)",
          }}
        >
          <p>{note.text}</p>
          {txHash && (
            <a className="link mono mt-1 block break-all" href={net.explorerTx(txHash)} target="_blank" rel="noreferrer">
              {txHash}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** "Deliver" needs a file, so the user can prove what they meant to hand over. */
function DeliverButton({
  onDeliver,
  busy,
  disabled,
}: {
  onDeliver: (digest: Uint8Array) => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <label className={`btn btn-primary w-full ${disabled ? "opacity-45" : ""}`}>
      {busy ? "Confirm in wallet…" : "Deliver the file"}
      <input
        type="file"
        className="sr-only"
        disabled={disabled}
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          if (!file) return;
          onDeliver(await sha256Bytes(await file.text()));
        }}
      />
    </label>
  );
}

function shortError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // Keep the useful part: the host error code and its meaning.
  const m = raw.match(/Error\(Contract, #(\d+)\)/);
  const meaning: Record<string, string> = {
    "2": "this job is not on chain yet",
    "3": "that job is not in a state that allows this — released money cannot be reversed",
    "4": "the dispute window has closed",
    "5": "this job is already closed",
    "6": "the delivery deadline has passed",
  };
  if (m && meaning[m[1]]) return meaning[m[1]];
  const sim = raw.match(/HostError: Error\(Contract, #\d+\)/);
  if (sim) return "the contract refused this — " + (raw.match(/Failed Diagnostic Event[^"]*"([^"]{0,160})"/)?.[1] ?? "see the contract");
  return raw.split("\n")[0].slice(0, 180);
}
