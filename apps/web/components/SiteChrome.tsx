"use client";

/**
 * The footer, and the network switch in the header.
 *
 * Both live here because both need to know which network the viewer is looking
 * at, which is only knowable on the client — and a server component cannot call
 * a client hook. That is also why the layout stays a server component and simply
 * renders these.
 */
import { useNetwork, NETWORKS } from "@/lib/network-context";
import type { ClientConfig } from "@/lib/client-config";

/**
 * The mark: a check that has crossed a line. The left stroke is the work, the
 * right stroke is the settlement, and the gap between them is the moment the two
 * meet — which is the whole product in one glyph. The same shape is the favicon,
 * so the two cannot drift apart.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Proved">
      <rect width="32" height="32" rx="7" fill="var(--brand-deep)" />
      <path
        d="M7 16.5l4.5 4.5L16 10"
        fill="none"
        stroke="#8b7f70"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 21.5l2.5 2.5L26 12"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NetworkSwitch({ configs }: { configs: Record<string, ClientConfig> }) {
  const { network, setNetwork } = useNetwork();

  return (
    <details className="relative">
      <summary
        className="pill pill-open mono cursor-pointer select-none"
        style={{ listStyle: "none" }}
        aria-label={`Network: ${network}. Change`}
      >
        {network}
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className="ml-1 inline-block align-middle">
          <path
            d="M2 4l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      {/* Padding on the panel rather than margins on the items: margins collapse
          through the container's edges, so the first item sat flush against the
          border and the last was clipped by the rounding. */}
      <div
        className="absolute right-0 z-20 mt-2 w-64 rounded-lg border p-1.5"
        style={{
          background: "var(--card)",
          borderColor: "var(--line)",
          boxShadow: "0 10px 28px rgba(0,0,0,.16)",
        }}
      >
        {NETWORKS.map((n, i) => {
          const cfg = configs[n];
          const ready = Boolean(cfg?.contractId);
          const active = n === network;
          return (
            <button
              key={n}
              type="button"
              onClick={(e) => {
                // <details> is uncontrolled and a click does not change the URL,
                // so it would stay open across the whole session.
                e.currentTarget.closest("details")?.removeAttribute("open");
                setNetwork(n);
              }}
              className="block w-full cursor-pointer rounded-md border-0 px-3 py-2.5 text-left"
              style={{
                background: active ? "var(--paper)" : "transparent",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
                borderRadius: "6px",
                textAlign: "left",
              }}
              aria-current={active}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">
                  {n === "mainnet" ? "Mainnet" : "Testnet"}
                </span>
                {active && (
                  <span className="mono text-[11px]" style={{ color: "var(--accent)" }}>
                    viewing
                  </span>
                )}
              </div>
              <div className="mono text-[11px]" style={{ color: "var(--ink-soft)" }}>
                {ready ? `${cfg.contractId.slice(0, 10)}…` : "not deployed"}
              </div>
              <div className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
                {!ready && cfg?.unconfigured
                  ? `not configured: ${cfg.unconfigured.replace(/^.*?: /, "")}`
                  : n === "mainnet"
                    ? "Real Circle USDC. Reads work; funding needs a wallet."
                    : "Self-minted test asset. Funding is one click."}
              </div>
            </button>
          );
        })}
      </div>
    </details>
  );
}

/** Names the contract the viewer is actually looking at, not the build's. */
export function SiteFooter() {
  const { network, config } = useNetwork();
  const cfg = config;

  return (
    <footer
      className="border-t px-5 py-6 text-xs"
      style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
    >
      <div className="mx-auto max-w-3xl space-y-1.5">
        <p>
          Soroban contract{" "}
          {cfg.contractId ? (
            <a
              className="link mono"
              href={cfg.explorerContractBase + cfg.contractId}
              target="_blank"
              rel="noreferrer"
            >
              {cfg.contractId.slice(0, 8)}…
            </a>
          ) : (
            <span className="mono">
              not configured on {network}
              {cfg.unconfigured ? ` — ${cfg.unconfigured.replace(/^.*?: /, "")}` : ""}
            </span>
          )}
          {network === "testnet" && " · testnet, not audited, no real value"}
          {network === "mainnet" && " · mainnet, settling in Circle USDC"}
        </p>
        <p>
          Dispute costs 0.15% of the job amount, floor 1.00. Upwork charges{" "}
          <span className="mono">$337.50</span> flat, for anyone.
        </p>
      </div>
    </footer>
  );
}