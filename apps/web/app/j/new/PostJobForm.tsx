"use client";

/**
 * Funding a job, in demo mode.
 *
 * Opening a job needs two signatures — payer and worker — which one browser
 * cannot produce. On testnet this form posts to a server action that signs with
 * the repository's committed testnet keys, so the flow is reproducible by anyone
 * who clones it. That is a property of a testnet demo, and the button says so.
 *
 * The commitment is the point of the form. You pick a real file; its SHA-256 is
 * what gets written on chain. The file never leaves your browser — only the hash
 * does — so "the worker gets paid for byte-for-byte delivering the thing you
 * named" is literal, and there is no server in the middle to be trusted.
 */
import { useState } from "react";

export function PostJobForm({
  network,
  contractId,
}: {
  network: string;
  contractId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [spec, setSpec] = useState<string | null>(null);

  const toHex = (buf: ArrayBuffer) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  /** Hash the chosen file's bytes in the browser. The file is never uploaded. */
  async function commitTo(file: File) {
    setErr(null);
    try {
      setDigest(toHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())));
      setSpec(`${file.name} · ${file.size.toLocaleString()} bytes`);
    } catch {
      setErr("could not read that file");
    }
  }

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
          description: spec ?? fd.get("description"),
          amount: fd.get("amount"),
          worker: fd.get("worker"),
          // Sent only when a real file was chosen; otherwise the server hashes
          // the description, which is weaker and labelled as such on the job.
          ...(digest ? { condition: digest } : {}),
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
        <span className="label mb-1.5 block">The deliverable</span>

        {digest ? (
          <div className="card space-y-2" style={{ borderColor: "var(--accent)" }}>
            <p className="mono text-[13px] break-all">
              <span style={{ color: "var(--ink-soft)" }}>committing to </span>
              {spec}
            </p>
            <p className="mono text-[11px] break-all" style={{ color: "var(--ink-soft)" }}>
              sha256 {digest}
            </p>
            <p className="text-[13px]" style={{ color: "var(--ink-soft)" }}>
              Written on chain before any work starts. The file stayed in your browser — only this
              hash was sent.
            </p>
            <label className="btn btn-ghost cursor-pointer">
              Choose a different file
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) void commitTo(f);
                }}
              />
            </label>
          </div>
        ) : (
          <>
            <label className="btn btn-primary w-full cursor-pointer">
              Choose the deliverable file
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) void commitTo(f);
                }}
              />
            </label>
            <p className="mt-2 text-[13px]" style={{ color: "var(--ink-soft)" }}>
              Or name it, which commits to a hash of the name instead — weaker, and the job will
              say so.
            </p>
            <input
              name="description"
              defaultValue="homepage-mockup.fig"
              placeholder="the file whose hash defines done"
              className="mono mt-2 h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--line)" }}
            />
          </>
        )}
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