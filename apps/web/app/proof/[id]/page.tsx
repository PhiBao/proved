import Link from "next/link";
import { contractId, loadJob, networkConfig, networkFromEnv, read } from "@/lib/proved";
import { jobIdArg, money, normaliseJobId, STATE_LABEL, type JobState } from "@/lib/client-config";

export const dynamic = "force-dynamic";

/**
 * The portable proof.
 *
 * This page is the retention and sharing loop: it renders from chain state
 * alone. No account, no login, no server database, nothing the payer controls.
 * A freelancer can show it to the next client, and it keeps meaning the same
 * thing after they leave any platform.
 */
export default async function ProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = normaliseJobId((await params).id);
  const n = networkFromEnv();
  const net = networkConfig(n);
  const { job, state, decimals } = await loadJob(n, id);

  const att = await read<[string, string, boolean, number]>(n, "attestation", {
    id: jobIdArg(id),
  }).catch(() => null);

  if (!job) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">No such proof</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          <span className="mono">{id.slice(0, 20)}…</span> is not on chain.
        </p>
      </div>
    );
  }

  const delivered = att?.[2] ?? state === 2;
  const s = (state ?? 0) as JobState;

  return (
    <div className="space-y-4">
      <div>
        <p className="label mb-1">Portable proof</p>
        <h1 className="text-xl font-bold tracking-tight">
          {delivered ? "Delivered and paid" : STATE_LABEL[s]}
        </h1>
      </div>

      <div className="card space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">amount</span>
          <span className="mono text-lg font-semibold">
            {money(att?.[1] ?? job.amount, decimals)} {net.assetCode}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">worker</span>
          <a
            className="mono link text-sm"
            href={net.explorerAccount(job.freelancer)}
            target="_blank"
            rel="noreferrer"
          >
            {job.freelancer.slice(0, 12)}…
          </a>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">payer</span>
          <a
            className="mono link text-sm"
            href={net.explorerAccount(job.client)}
            target="_blank"
            rel="noreferrer"
          >
            {job.client.slice(0, 12)}…
          </a>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">reversible?</span>
          <span
            className="mono text-sm"
            style={{ color: delivered ? "var(--accent)" : "var(--ink-soft)" }}
          >
            {delivered ? "no — settled on chain" : "open"}
          </span>
        </div>
      </div>

      <div className="card">
        <p className="label mb-2">How this was verified</p>
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          The contract compared the artifact the worker submitted against a hash the payer signed{" "}
          <em>at the moment they funded the job</em>. A match released the funds in that same
          transaction. Nothing here comes from our server, because there is nothing to check — ask
          the chain.
        </p>
        <a
          className="link mono mt-3 inline-block text-[13px] break-all"
          href={net.explorerContract(contractId(n))}
          target="_blank"
          rel="noreferrer"
        >
          {contractId(n)}
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/j/${id}?as=freelancer`}
          className="btn btn-ghost"
        >
          Open the job
        </a>
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
