"use client";

/**
 * The job-id field on the home page, and the one on /work.
 *
 * Both are pre-filled with a job that has actually settled. The first thing a
 * judge does with a demo is type nothing and press the button, so making them
 * invent a 64-character hash before they can see anything is a bad first
 * impression — and the ids are long enough that nobody will remember one.
 *
 * The id is a `defaultValue` rather than controlled state so it stays editable:
 * pre-filling must not stop someone pasting their own.
 */
import { useEffect, useState } from "react";

/** A job funded, delivered and released on testnet. Used unless told otherwise. */
const SETTLED_TESTNET =
  process.env.NEXT_PUBLIC_SHOWCASE_JOB_TESTNET ?? "";
const SETTLED_MAINNET =
  process.env.NEXT_PUBLIC_SHOWCASE_JOB_MAINNET ?? "";

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
  const [value, setValue] = useState("");

  // Chosen after mount rather than at render: reading the network context during
  // the first pass would render the other network's id and then swap it, which
  // is a hydration mismatch rather than a pre-fill.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("net");
    const stored = (() => {
      try {
        return window.localStorage.getItem("proved:net");
      } catch {
        return null;
      }
    })();
    const net = wanted === "mainnet" || wanted === "testnet" ? wanted : stored;
    // Both are build-time inlined and may be absent, in which case there is
    // nothing to pre-fill and the field starts empty.
    const filled = net === "mainnet" ? SETTLED_MAINNET : SETTLED_TESTNET;
    setValue(typeof filled === "string" ? filled : "");
  }, []);

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
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="mono h-[44px] w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--line)" }}
        />
      </div>
      <button type="submit" className="btn btn-ghost">
        {submitLabel}
      </button>
    </>
  );
}