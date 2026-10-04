import Link from "next/link";
import JobPanel from "./JobPanel";
import { allClientConfigs } from "@/lib/proved";

export const dynamic = "force-dynamic";

/**
 * The job screen.
 *
 * A thin shell: everything that decides anything lives in `JobPanel`, because
 * the network is the viewer's choice now. The server's only job is to resolve
 * the id and hand over both networks' config.
 *
 * Job ids are per-network, so switching networks on a job page is a real
 * possibility rather than a curiosity — the panel reports "not on this network"
 * rather than an empty card, which is the honest answer for a testnet id looked
 * up while viewing mainnet.
 */
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">Your job</h1>
        <Link
          href={`/j/${id}?as=${role === "client" ? "freelancer" : "client"}`}
          className="text-xs underline underline-offset-2"
          style={{ color: "var(--ink-soft)" }}
        >
          switch side
        </Link>
      </div>
      <JobPanel jobId={id} role={role} configs={allClientConfigs()} />
    </div>
  );
}