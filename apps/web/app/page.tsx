import Link from "next/link";
import { JobIdField } from "@/components/JobIdField";
import { ContractFacts } from "@/components/ContractFacts";

export default function Home() {
  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------- hook -- */}
      <section className="space-y-5">
        <h1 className="text-3xl font-bold leading-[1.15] tracking-tight sm:text-[40px]">
          Upwork charges{" "}
          <span className="mono">$337.50</span> to appeal a{" "}
          <span className="mono">$300</span> dispute.
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          That single number is why most disputes never happen. The worker who cannot afford to
          appeal simply eats it. Ours costs <strong style={{ color: "var(--ink)" }}>0.15% of the job
          amount</strong> — about <span className="mono">$1.80</span> on a{" "}
          <span className="mono">$1,200</span> job — because on Stellar, judging costs gas, not a
          fee.
        </p>
      </section>

      {/* ------------------------------------------------------ the person -- */}
      <section className="card">
        <p className="label mb-2">Why it matters</p>
        <p className="text-[15px] leading-relaxed">
          A Top Rated Plus freelancer on Upwork — eleven years,{" "}
          <span className="mono">$446,922</span> earned, 100% job success, zero violations — was
          banned after an identity check. Escrow reversed. Four clients, including a CEO, fought
          to keep him. He had paid <span className="mono">$44,797</span> in fees over his career.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          His history was not his. Here it is: counters in a contract he controls, and they set how
          much of his own money he has to lock up to get paid.
        </p>
      </section>

      {/* --------------------------------------------------- what changes -- */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">What actually changes</h2>
        <ul className="space-y-3">
          <li className="card">
            <p className="font-semibold">No review window</p>
            <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              Delivery is checked against a commitment the client signed <em>when they paid</em>. If
              it matches, money moves in the same transaction. There is no 14-day hold, so there is
              nothing to charge back — including the 30-day clawback that hit{" "}
              <span className="mono">$32,000</span> of completed work on Upwork.
            </p>
          </li>
          <li className="card">
            <p className="font-semibold">A bond instead of an arbitration fee</p>
            <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              Contesting scales with the money: 0.15%, floored at{" "}
              <span className="mono">1.00</span> so spamming challenges costs more than the gas it
              burns. A dispute you cannot afford to raise is a dispute you lose.
            </p>
          </li>
          <li className="card">
            <p className="font-semibold">Both sides are protected</p>
            <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              Client funds the job, freelancer locks what their reputation charges, and both
              authorise it in one transaction. Neither can fund and walk away.
            </p>
          </li>
        </ul>
      </section>

      {/* --------------------------------------------------------- enter -- */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">See it work</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/j/new" className="btn btn-primary">
            I&apos;m hiring — post a job
          </Link>
          <Link href="/work" className="btn btn-ghost">
            I&apos;m the one doing the work
          </Link>
        </div>
        <form action="/proof" className="card">
          <JobIdField label="Already have a job id? Look up its proof" />
        </form>
      </section>

      {/* ---------------------------------------------------------- proof -- */}
      <section className="card">
        <p className="label mb-2">Read the contract</p>
        <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          The invariant is four lines in one function:{" "}
          <code className="mono text-[13px]">challenge()</code> refuses any job that is not{" "}
          <span className="mono">Open</span>, and no other entry point moves funds out of a released
          job. There is no admin key and no upgrade path.
        </p>
        <ContractFacts />
      </section>
    </div>
  );
}
