"use client";

/**
 * Demo-mode job creation.
 *
 * Opening a job needs two signatures — payer and worker — which a single browser
 * cannot produce. On testnet this form posts to a server action that signs with
 * the repository's committed testnet keys, so the whole flow is reproducible by
 * anyone who clones it. That is a property of a testnet demo, and the form says
 * so on the button.
 */
import { useState } from "react";
import { sha256Hex } from "@/lib/proved";

export function PostJobForm({
  network,
  contractId,
}: {
  network: string;
  contractId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/demo/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: fd.get("description"),
          amount: fd.get("amount"),
          worker: fd.get("worker"),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "could not open the job");
      window.location.href = `/j/${body.jobId}?as=client`;
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label mb-1.5 block" htmlFor="description">
          What is being delivered?
        </label>
        <input
          id="description"
          name="description"
          required
          defaultValue="homepage-mockup.fig"
          placeholder="the file whose hash defines done"
          className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--line)" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-1.5 block" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            defaultValue="1200"
            className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--line)" }}
          />
        </div>
        <div>
          <label className="label mb-1.5 block" htmlFor="worker">
            Worker
          </label>
          <select
            id="worker"
            name="worker"
            className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--line)" }}
          >
            <option value="freelancer">the freelancer (needs a $36 stake)</option>
            <option value="proven">the proven worker (needs $0)</option>
          </select>
        </div>
      </div>

      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Signing two transactions on chain…" : "Fund it"}
      </button>

      {err && (
        <p className="text-[13px]" style={{ color: "var(--warn)" }}>
          {err}
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
        {network === "testnet" ? (
          <>
            Testnet demo: this signs with the repository&apos;s committed testnet keys, so the flow
            is reproducible without installing a wallet. Nothing here has value.
          </>
        ) : (
          <>Mainnet: the demo custodian is disabled. Connect a wallet to fund for real.</>
        )}{" "}
        <span className="mono">{contractId.slice(0, 10)}…</span>
      </p>
    </form>
  );
}

export async function unusedSha() {
  return sha256Hex("");
}
