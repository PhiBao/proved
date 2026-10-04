"use client";

/**
 * The visible wallet control.
 *
 * Previously the app connected only inside an action handler, so there was no
 * way to see wallet state before clicking Deliver, Challenge, or Settle. The
 * missing-wallet error then arrived after the click, which made it look like
 * the contract had refused rather than the browser having nothing to sign with.
 *
 * It also warns when the wallet points at a different chain than the app is
 * viewing. A signature made for the wrong passphrase is invalid, and without
 * the warning that surfaces as a baffling signing failure instead of a
 * one-line fix in the wallet.
 */
import { shortAddress, useWallet } from "@/lib/wallet-context";
import { useNetwork } from "@/lib/network-context";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const {
    status,
    address,
    walletNetwork,
    walletPassphrase,
    error,
    connect,
    disconnect,
  } = useWallet();
  const { network, config } = useNetwork();

  const mismatched =
    status === "connected" &&
    walletPassphrase !== null &&
    walletPassphrase !== config.passphrase;

  if (status === "checking") {
    return (
      <span className="pill pill-open mono" aria-live="polite">
        checking wallet…
      </span>
    );
  }

  if (status === "connected" && address) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <span className="inline-flex items-center gap-2">
          <span
            className="pill pill-paid mono"
            title={`Connected on ${walletNetwork ?? "unknown network"}: ${address}`}
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
        {!compact && mismatched && (
          <span className="text-xs" style={{ color: "var(--warn)" }} role="alert">
            Wallet is on {walletNetwork ?? "another network"} — switch it to {network} before
            signing.
          </span>
        )}
      </span>
    );
  }

  if (status === "unavailable") {
    return (
      <span className="inline-flex flex-col gap-1">
        <span
          className="pill pill-open mono"
          title="Freighter did not answer. It may be missing, disabled for this site, or blocked from injecting."
        >
          no wallet
        </span>
        {!compact && (
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            Install and enable Freighter to sign on {network}. Testnet demo mode does not need
            one.
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
