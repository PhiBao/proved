import { redirect } from "next/navigation";
import { JobIdField } from "@/components/JobIdField";

export const dynamic = "force-dynamic";

/** Freelancer entry point: paste the job id you were sent. */
export default async function Work({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (id) redirect(`/j/${id}?as=freelancer`);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight">You&apos;re the one doing the work</h1>

      <div className="card space-y-3">
        <p className="text-[15px] leading-relaxed">
          A payer has already funded the job. Their money is in the contract. Open the job, hand
          over your file, and if it matches what they committed to you are paid — immediately, and
          with no window in which they can change their mind.
        </p>
        <form action="/work" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <JobIdField
            id="wid"
            label="Job id from your link"
            submitLabel="Open job"
          />
        </form>
      </div>

      <div className="card">
        <p className="label mb-2">What you get out of it</p>
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          Every verified delivery adds to a counter that belongs to you, on the chain, and that
          follows you off this site. That counter decides how much of your own money you have to
          lock up next time — from 3% down to nothing.
        </p>
      </div>
    </div>
  );
}
