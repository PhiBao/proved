"use client";

/**
 * The portable proof.
 *
 * This page is the retention and sharing loop: it renders from chain state
 * alone. No account, no login, no server database, nothing the payer controls.
 * A freelancer can show it to the next client and it keeps meaning the same
 * thing after they leave any platform.
 *
 * It is a client component because the network is now the viewer's choice. As a
 * server component it could only ever show whichever network the build was
 * pointed at, which meant a mainnet proof link was unreachable without a
 * redeploy — the exact problem the switcher exists to remove.
 *
 * The read is the same one the server used to make: `attestation` returns
 * `(freelancer, amount, delivered, state)` derived from chain state, so a
 * missing contract, an unreachable RPC and a job that does not exist are three
 * distinguishable outcomes rather than one blank page.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useNetwork } from "@/lib/network-context";
import { getClientFor, money, normaliseJobId, STATE_LABEL, jobIdArg, type JobState } from "@/lib/client-config";

const READ_AS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

type Attestation = [string, string, boolean, number];

export default function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>("");
  useEffect(() => {
    void params.then((p) => setId(normaliseJobId(p.id)));
  }, [params]);

  if (!id) return <div className="space-y-4" />;

  return <Proof id={id} />;
}

function Proof({ id }: { id: string }) {
  const { network, config } = useNetwork();
  const [att, setAtt] = useState<Attestation | null>(null);
  const [state, setState] = useState<number | null>(null);
  const [decimals, setDecimals] = useState<number>(7);
  const [phase, setPhase] = useState<"loading" | "missing" | "unreachable" | "ok">("loading");

  useEffect(() => {
    if (!config.contractId) {
      setPhase("unreachable");
      return;
    }
    let cancelled = false;
    setPhase("loading");
    setAtt(null);
    setState(null);

    (async () => {
      try {
        const c = await getClientFor(config);
        const [a, st, dec] = await Promise.all([
          c.attestation({ id: jobIdArg(id) }, { publicKey: READ_AS }) as Promise<{
            result: Attestation | null;
          }>,
          c.state({ id: jobIdArg(id) }, { publicKey: READ_AS }),
          // Precision comes from the deployed contract rather than a constant.
          // It is 7 for both the test asset and Stellar's USDC, but assuming that
          // is exactly the mistake that misprices an amount by 10x.
          c.decimals({ publicKey: READ_AS }),
        ]);
        if (cancelled) return;
        // A job that was never funded reads as absent rather than panicking, so
        // this is the expected answer for a made-up id.
        if (!a.result) {
          setPhase("missing");
          return;
        }
        setAtt(a.result);
        setState(Number(st.result));
        setDecimals(Number(dec.result));
        setPhase("ok");
      } catch {
        if (!cancelled) setPhase("unreachable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, network, config]);

  if (phase === "loading") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Reading the chain…</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          <span className="mono">{id.slice(0, 20)}…</span> on {network}
        </p>
      </div>
    );
  }

  if (phase === "missing") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">No such proof</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          <span className="mono">{id.slice(0, 20)}…</span> is not on chain on{" "}
          <strong>{network}</strong>. Job ids are per-network, so a testnet id will not resolve
          here — try the switch in the header.
        </p>
        <Link href="/" className="btn btn-ghost inline-block">
          Home
        </Link>
      </div>
    );
  }

  if (phase === "unreachable" || !att) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Cannot reach {network}</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          The contract read failed. The RPC endpoint may be down, or no contract is deployed on this
          network.
        </p>
        <Link href="/" className="btn btn-ghost inline-block">
          Home
        </Link>
      </div>
    );
  }

  const [worker, amountRaw, delivered, attState] = att;
  const s = (state ?? attState) as JobState;
  const label = STATE_LABEL[s] ?? "unknown";

  return (
    <div className="space-y-4">
      <div>
        <p className="label mb-1">Portable proof</p>
        <h1 className="text-xl font-bold tracking-tight">
          {delivered && s === 2 ? "Delivered and paid" : label}
        </h1>
      </div>

      <div className="card space-y-3">
        <Row k="amount" v={`${money(amountRaw, decimals)} ${config.assetCode}`} />
        <Row
          k="worker"
          v={
            <a
              className="mono link text-sm"
              href={config.explorerAccountBase + worker}
              target="_blank"
              rel="noreferrer"
            >
              {worker.slice(0, 8)}…
            </a>
          }
        />
        <Row k="network" v={network} />
        <Row
          k="reversible?"
          v={
            <span className="mono text-sm" style={{ color: "var(--accent)" }}>
              {s === 1 ? "not yet — still open" : "no — settled on chain"}
            </span>
          }
        />
      </div>

      <div className="card">
        <p className="label mb-2">How this was verified</p>
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          The contract compared the artifact the worker submitted against a hash the payer signed{" "}
          <em>at the moment they funded the job</em>. A match released the funds in that same
          transaction. Nothing here comes from our server, because there is nothing to check — ask
          the chain.
        </p>
        {config.contractId ? (
          <a
            className="link mono mt-3 inline-block text-[13px] break-all"
            href={config.explorerContractBase + config.contractId}
            target="_blank"
            rel="noreferrer"
          >
            {config.contractId}
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/j/${id}?as=freelancer`} className="btn btn-ghost">
          Open the job
        </Link>
        <Link href="/" className="btn btn-ghost">
          Home
        </Link>
      </div>

      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
        job id <span className="mono break-all">{id}</span>
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label">{k}</span>
      <span className="mono text-lg font-semibold">{v}</span>
    </div>
  );
}