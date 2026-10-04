import { redirect } from "next/navigation";
import { PostJobForm } from "./PostJobForm";
export const dynamic = "force-dynamic";

export default async function NewJob({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  // A server action posted the job and handed us its id.
  if (id) redirect(`/j/${id}?as=client`);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight">Post a job</h1>

      <div className="card space-y-3">
        <p className="text-[15px] leading-relaxed">
          You commit to what &quot;done&quot; means before you pay. The worker&apos;s file is hashed and
          compared against it. If it matches, they are paid instantly — and you cannot take it
          back. That is the trade, and it is why they will work for someone they have never met.
        </p>

        <PostJobForm />
      </div>

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">
          Why does the worker have to sign too?
        </summary>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          Both parties authorise the same transaction. You fund the job; they lock whatever their
          reputation charges — <span className="mono">3%</span> for an unknown account, halving
          with every verified delivery, and nothing once the amount drops below{" "}
          <span className="mono">5.00</span>. Neither side can fund and walk away.
        </p>
      </details>
    </div>
  );
}
