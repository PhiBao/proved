"use client";

/**
 * The visible wallet control.
 *
 * Previously the app connected only inside an action handler, so there was no
 * way to see wallet state before clicking Deliver, Challenge, or Settle. The
 * missing-wallet error then arrived after the click, which made it look like
 * the contract had refused rather than the browser having nothing to sign with.
 */
import { shortAddress, useWallet } from "@/lib/wallet-context";
import { useNetwork } from "@/lib/network-context";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { status, address, error, connect, disconnect } = useWallet();
  const { network } = useNetwork();

  if (status === "checking") {
    return (
      <span className="pill pill-open mono" aria-live="polite">
        checking wallet…
      </span>
    );
  }

  if (status === "connected" && address) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="pill pill-paid mono"
          title={`Connected on ${network}: ${address}`}
        >
          {shortAddress(address)}
        </span>
        {!compact && (
          <button
            type="button"
            onClick={disconnect}
            className="text-xs underline underline-offset-4"
            style={{ color: "var(--ink-soft)" }}
          >
            Forget
          </button>
        )}
      </span>
    );
  }

  if (status === "unavailable") {
    return (
      <span className="inline-flex flex-col gap-1">
        <span
          className="pill pill-open mono"
          title="No Freighter-compatible wallet was detected in this browser."
        >
          no wallet
        </span>
        {!compact && (
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            Install Freighter to sign on {network}. Testnet demo mode does not need one.
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void connect()}
        disabled={status === "connecting"}
        className="btn btn-ghost"
        title={`Connect a wallet for ${network}`}
      >
        {status === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>
      {!compact && error && (
        <span className="text-xs" style={{ color: "var(--warn)" }} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
