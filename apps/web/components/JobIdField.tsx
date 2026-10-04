"use client";

/**
 * The job-id field on the home page and on /work.
 *
 * Pre-filled with a job that has actually settled, so a judge can press the
 * button instead of inventing a 64-character hash nobody will remember.
 *
 * The field owns its own layout rather than being a fragment inside the form's
 * flex row. As a fragment, adding the note under the input made that column
 * taller and `items-end` dropped the button to the bottom of it — the button sat
 * below the field instead of beside it. Anything under the row has to live
 * outside the row.
 *
 * Two behaviours worth stating, because both were wrong on the first attempt:
 *
 *   - The pre-fill follows the selected network. Reading the URL once on mount
 *     left the old network's id in place after a switch, which resolves to
 *     nothing on the screen meant to look good.
 *   - A pasted id is never cleared. Tracking "is this still a default?" does not
 *     work, because the field only ever equals the current network's default, so
 *     anything pasted looked untouched and was overwritten. A ref records
 *     whether the viewer actually typed, and the effect leaves it alone.
 *
 * The form also carries the network the id belongs on, so a pre-filled testnet
 * job opens correctly even when the viewer is looking at mainnet. That is what
 * makes mainnet a safe default: reads work there, and the one-click demo still
 * works.
 */
import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/lib/network-context";

/**
 * A job that funded, delivered and released on each network, from a real run.
 *
 * Build-time inlined and possibly absent, which is the normal case for mainnet:
 * a funded settlement there needs real USDC in four separately funded accounts,
 * so none exists yet.
 */
const SHOWCASE: Record<string, string> = {
  testnet: process.env.NEXT_PUBLIC_SHOWCASE_JOB_TESTNET ?? "",
  mainnet: process.env.NEXT_PUBLIC_SHOWCASE_JOB_MAINNET ?? "",
};

/**
 * The id to show, falling back to the other network's.
 *
 * Mainnet has no funded settlement, and an empty box with `required` makes the
 * button a no-op — so on a mainnet view the field shows the testnet job, says
 * which chain it settled on, and submits with that network. The button then works
 * from either view, which is the point of pre-filling it at all.
 */
function defaultFor(network: string): string {
  return SHOWCASE[network] || SHOWCASE.testnet || "";
}

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

  useEffect(() => {
    if (typed.current) return;
    setValue(defaultFor(network));
  }, [network]);

  /**
   * Which network the id in the box actually lives on.
   *
   * Falls back to the selected network for anything the viewer pasted, which is
   * the only thing that can be known about an id we have never seen.
   */
  const owner = (() => {
    const v = value.trim();
    for (const [net, id2] of Object.entries(SHOWCASE)) {
      if (id2 && id2 === v) return net;
    }
    return network;
  })();

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
              typed.current = e.target.value !== defaultFor(network);
              setValue(e.target.value);
            }}
            placeholder={placeholder}
            className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
            style={{ borderColor: "var(--line)" }}
          />
        </div>
        {/* The network the id belongs on, so a pre-filled job opens on the chain it
            was settled on rather than the one currently being viewed. */}
        <input type="hidden" name="net" value={owner} />
        <button type="submit" className="btn btn-ghost">
          {submitLabel}
        </button>
      </div>

      {value.trim() === "" ? (
        <p className="text-[12px]" style={{ color: "var(--ink-soft)" }}>
          No settled job to show on <strong>{network}</strong>. The contract is live there and its
          economics read correctly, but a funded settlement needs real USDC in four separately
          funded accounts and we have not funded one. Paste a job id to look up its proof.
        </p>
      ) : owner !== network ? (
        <p className="text-[12px]" style={{ color: "var(--ink-soft)" }}>
          This job settled on <strong>{owner}</strong>, so the button opens it there. Job ids are
          per-network, and <strong>mainnet has no funded settlement yet</strong> — funding one needs
          real USDC in four separately funded accounts.{" "}
          <a href={`/j/new`} className="link">
            Post one yourself
          </a>
          .
        </p>
      ) : (
        <p className="text-[12px]" style={{ color: "var(--ink-soft)" }}>
          Pre-filled with a job that funded, delivered and released on {owner}. Paste over it to
          look up your own.
        </p>
      )}
    </div>
  );
}