"use client";

/**
 * The job-id field on the home page and on /work.
 *
 * Pre-filled with a job that has actually settled, so a judge can press the
 * button instead of inventing a 64-character hash nobody will remember.
 *
 * The pre-fill follows the selected network, because job ids are per-network: a
 * testnet id on mainnet resolves to "not on chain", which is a bad first
 * impression on the one screen meant to look good. It follows the switch, too,
 * rather than only reading the URL once on mount.
 *
 * A pasted id is never overwritten. If the field still holds one of the known
 * defaults when the network changes it is swapped for the other network's
 * default; if it holds anything the viewer typed, it is left alone, because
 * silently clearing someone's own id would be worse than a stale one.
 */
import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/lib/network-context";

/**
 * A job that funded, delivered and released on each network, from a real run.
 * Both are build-time inlined and may be absent, in which case there is nothing
 * to pre-fill and the field starts empty.
 */
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

  /**
   * Whether the viewer has put their own id in.
   *
   * A ref rather than state: the effect that follows the network has to read it,
   * and making it state would put the effect in its own dependency list and
   * re-run on every keystroke. Once someone pastes an id, switching networks
   * must not clear it — silently discarding what someone typed is worse than
   * leaving an id that resolves on the other network, and the page already
   * explains that ids are per-network.
   */
  const typed = useRef(false);

  // Chosen after mount rather than at render: reading the network during the
  // first pass would render one network's id and then swap it, which is a
  // hydration mismatch rather than a pre-fill.
  useEffect(() => {
    if (typed.current) return;
    setValue(SHOWCASE[network] ?? "");
  }, [network]);

  return (
    <>
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
            // Anything that is not the default we put there is the viewer's.
            typed.current = e.target.value !== (SHOWCASE[network] ?? "");
            setValue(e.target.value);
          }}
          placeholder={placeholder}
          className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--line)" }}
        />
        {value.trim() === "" && (
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-soft)" }}>
            No showcase job on {network} — paste a job id to look up its proof.
          </p>
        )}
      </div>
      <button type="submit" className="btn btn-ghost">
        {submitLabel}
      </button>
    </>
  );
}