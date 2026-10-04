"use client";

/**
 * The job-id field on the home page and on /work.
 *
 * Each network gets only its own settled job. Job ids are single-network, so
 * borrowing the other network's id as a fallback made the button look broken on
 * exactly the view that mattered.
 */
import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/lib/network-context";

/** Settled jobs, one per network. Empty means that network has none yet. */
const SHOWCASE: Record<string, string> = {
  testnet: process.env.NEXT_PUBLIC_SHOWCASE_JOB_TESTNET ?? "",
  mainnet: process.env.NEXT_PUBLIC_SHOWCASE_JOB_MAINNET ?? "",
};

export function JobIdField({
  label,
  placeholder = "hex job id",
  id = "jid",
  submitLabel = "Open proof",
}: {
  label: string;
  placeholder?: string;
  id?: string;
  submitLabel?: string;
}) {
  const { network } = useNetwork();
  const [value, setValue] = useState("");
  const typed = useRef(false);

  // Chosen after mount rather than at render: reading the network during the
  // first pass would render one network's id and then swap it, which is a
  // hydration mismatch rather than a pre-fill.
  useEffect(() => {
    if (typed.current) return;
    setValue(SHOWCASE[network] ?? "");
  }, [network]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label mb-1.5 block" htmlFor={id}>
            {label}
          </label>
          <input
            id={id}
            name="id"
            required
            value={value}
            onChange={(e) => {
              typed.current = e.target.value !== (SHOWCASE[network] ?? "");
              setValue(e.target.value);
            }}
            placeholder={placeholder}
            className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--line)" }}
          />
        </div>
        {/* The network travels with the id, so a pasted link resolves on the chain
            it was settled on rather than the one currently being viewed. */}
        <input type="hidden" name="net" value={network} />
        <button type="submit" className="btn btn-ghost">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
