import Link from "next/link";
import { notFound } from "next/navigation";
import JobPanel from "./JobPanel";
import { clientConfig, loadJob, networkFromEnv, read } from "@/lib/proved";
import { jobIdArg, type ClientConfig } from "@/lib/client-config";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { id } = await params;
  const { as } = await searchParams;
  const role = as === "client" ? "client" : "freelancer";
  const cfg = clientConfig();
  const { job, state, decimals } = await loadJob(cfg.network, id);

  // Before any dispute, `challenge_bond` on chain is 0. The card asking "what
  // does a dispute cost here" must show the minimum the contract would demand,
  // so read that server-side too — otherwise the page flashes 0.00 and a
  // screenshot of it is simply wrong.
  let bondMinimum = job ? BigInt(job.challenge_bond).toString() : null;
  if (job && BigInt(job.challenge_bond) === 0n) {
    bondMinimum = await read<string>(cfg.network, "challenge_bond_for", {
      amount: BigInt(job.amount),
    }).catch(() => bondMinimum);
  }

  if (!job && state === 0) {
    // Not a missing route: the id may simply not be indexed yet.
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Nothing here yet</h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          No job <span className="mono">{id.slice(0, 16)}…</span> on chain. If you just created it,
          wait a few seconds.
        </p>
        <Link href="/" className="btn btn-ghost">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">
          {role === "client" ? "Your job" : "Your job"}
        </h1>
        <Link
          href={`/j/${id}?as=${role === "client" ? "freelancer" : "client"}`}
          className="text-xs underline underline-offset-2"
          style={{ color: "var(--ink-soft)" }}
        >
          switch side
        </Link>
      </div>
      <JobPanel
        jobId={id}
        role={role}
        initial={{ job, state, decimals, bondMinimum }}
        config={clientConfig()}
      />
    </div>
  );
}
