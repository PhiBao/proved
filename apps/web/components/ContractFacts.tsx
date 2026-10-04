"use client";

/**
 * The "read the contract" card on the home page.
 *
 * It reads the live chain rather than printing constants, and it has to follow
 * the network the viewer has switched to — which is why it is a client component
 * reading the same context as the header. Keeping it on the server would have
 * meant quoting whichever network the build was configured for, which is the
 * thing the switcher exists to stop doing.
 *
 * Two numbers, both read on mount and refreshed when the network changes:
 * the stake rate for an account with no history, and the settlement asset.
 */
import { useEffect, useState } from "react";
import { useNetwork } from "@/lib/network-context";
import { getClientFor } from "@/lib/client-config";

/** An address nobody controls, so its reputation is genuinely zero. */
const NOBODY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

interface Facts {
  bps?: string;
  token?: string;
}

export function ContractFacts() {
  const { network, config } = useNetwork();
  const [facts, setFacts] = useState<Facts | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!config.contractId) {
      setReachable(false);
      return;
    }
    let cancelled = false;
    setReachable(null);

    (async () => {
      try {
        const c = await getClientFor(config);
        const [bps, token] = await Promise.all([
          c.stake_bps({ freelancer: NOBODY }, { publicKey: NOBODY }),
          c.token({ publicKey: NOBODY }),
        ]);
        if (cancelled) return;
        // `token` comes back as an Address object, not a string, so it is
        // coerced here rather than relied on to interpolate usefully.
        const addr = token.result as unknown as { toString(): string };
        setFacts({
          bps: String(bps.result),
          token: (typeof addr === "string" ? addr : addr.toString()) ?? "",
        });
        setReachable(true);
      } catch {
        if (!cancelled) setReachable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [network, config]);

  return (
    <div className="mono mt-3 space-y-1 text-[13px]" style={{ color: "var(--ink-soft)" }}>
      {reachable === false ? (
        <p>contract not reachable on {network} — check the RPC endpoint</p>
      ) : (
        <>
          <p>
            stake for an unknown freelancer:{" "}
            <span style={{ color: "var(--ink)" }}>{facts?.bps ?? "…"} bps</span> (3.00%)
          </p>
          <p>
            settlement asset:{" "}
            <span style={{ color: "var(--ink)" }}>
              {facts?.token ? `${facts.token.slice(0, 10)}…` : "…"}
            </span>{" "}
            · {config.assetCode}
          </p>
        </>
      )}
      <p>
        deployment:{" "}
        {config.contractId ? (
          <a
            className="link"
            href={config.explorerContractBase + config.contractId}
            target="_blank"
            rel="noreferrer"
          >
            {config.contractId.slice(0, 12)}…
          </a>
        ) : (
          <span>not deployed</span>
        )}
      </p>
    </div>
  );
}