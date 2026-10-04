"use client";

/**
 * Browser-wallet connection state, through Freighter's official API.
 *
 * The previous version probed a hand-rolled `window.freighter` hook. Current
 * Freighter only answers its `@stellar/freighter-api` messenger, so detection
 * always failed on a modern install — the header said "no wallet" with the
 * extension sitting right there — and poking the legacy hook produced
 * extension-side errors instead of an address. This uses `isConnected`,
 * `requestAccess`, `getNetwork` and the SEP-43 signing calls, which are also
 * exactly the shapes the Stellar SDK's contract client accepts.
 *
 * Signatures are still the only thing the wallet does here. Reads use a fixed
 * observer address, and testnet demo mode uses committed server keys, so
 * connecting is unnecessary until someone funds, delivers, disputes, or
 * settles. One context means the header, the posting form, and the job screen
 * cannot disagree about whether a wallet is present.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getAddress,
  getNetwork as getWalletNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  signAuthEntry as freighterSignAuthEntry,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";

export type WalletStatus =
  | "checking"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected";

export interface ConnectedWallet {
  address: string;
  /**
   * The network Freighter itself is pointed at, e.g. "TESTNET". Compared
   * against the app's selected network by the button, because a signature
   * made for the wrong passphrase is simply invalid.
   */
  walletNetwork: string | null;
  walletPassphrase: string | null;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress: string }>;
  signAuthEntry: (
    entryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedAuthEntry: string | null; signerAddress: string }>;
}

interface WalletValue {
  status: WalletStatus;
  address: string | null;
  walletNetwork: string | null;
  walletPassphrase: string | null;
  error: string | null;
  connect: () => Promise<ConnectedWallet | null>;
  ensureConnected: () => Promise<ConnectedWallet | null>;
  disconnect: () => void;
}

const Ctx = createContext<WalletValue | null>(null);

const NO_WALLET =
  "No Freighter-compatible wallet found. Install Freighter to sign, or use testnet demo mode to click through without one.";

function describe(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** The signer object handed to the contract client, bound to one address. */
function signerFor(address: string): Pick<ConnectedWallet, "signTransaction" | "signAuthEntry"> {
  return {
    signTransaction: async (xdr, opts) => {
      const res = await freighterSignTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address ?? address,
      });
      if (res.error) throw new Error(res.error.message);
      return { signedTxXdr: res.signedTxXdr, signerAddress: res.signerAddress };
    },
    signAuthEntry: async (entryXdr, opts) => {
      const res = await freighterSignAuthEntry(entryXdr, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address ?? address,
      });
      if (res.error) throw new Error(res.error.message);
      return { signedAuthEntry: res.signedAuthEntry, signerAddress: res.signerAddress };
    },
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [address, setAddress] = useState<string | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [walletPassphrase, setWalletPassphrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (): Promise<ConnectedWallet | null> => {
    setStatus("connecting");
    setError(null);
    try {
      const installed = await isConnected();
      if (!installed.isConnected) {
        setStatus("unavailable");
        setError(NO_WALLET);
        return null;
      }

      // Combines the allow-list prompt and the address fetch. Resolves without
      // a popup when the app was already authorized.
      const access = await requestAccess();
      if (access.error || !access.address) {
        setStatus("disconnected");
        setError(access.error?.message ?? "The wallet refused the connection request.");
        return null;
      }

      // Best effort: knowing the wallet's own network lets the UI warn before
      // a signature is made for the wrong chain. A failure here must not fail
      // the connection itself.
      let net: string | null = null;
      let passphrase: string | null = null;
      try {
        const wnet = await getWalletNetwork();
        if (!wnet.error) {
          net = wnet.network || null;
          passphrase = wnet.networkPassphrase || null;
        }
      } catch {
        // Leave both null; the button simply shows no network warning.
      }

      setAddress(access.address);
      setWalletNetwork(net);
      setWalletPassphrase(passphrase);
      setStatus("connected");
      return { address: access.address, walletNetwork: net, walletPassphrase: passphrase, ...signerFor(access.address) };
    } catch (e) {
      setStatus("disconnected");
      setError(describe(e, "The wallet refused the connection request."));
      return null;
    }
  }, []);

  // Returning users who already authorized the app get their address back
  // without a popup. `getAddress` never prompts; it returns "" when unauthorized.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const installed = await isConnected();
        if (cancelled || !installed.isConnected) {
          if (!cancelled) setStatus("unavailable");
          return;
        }
        const allowed = await isAllowed();
        if (cancelled || !allowed.isAllowed) {
          if (!cancelled) setStatus("disconnected");
          return;
        }
        const [got, wnet] = await Promise.all([
          getAddress(),
          getWalletNetwork().catch(() => null),
        ]);
        if (cancelled) return;
        if (got.error || !got.address) {
          setStatus("disconnected");
          return;
        }
        setAddress(got.address);
        setWalletNetwork(wnet && !wnet.error ? (wnet.network || null) : null);
        setWalletPassphrase(wnet && !wnet.error ? (wnet.networkPassphrase || null) : null);
        setStatus("connected");
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureConnected = useCallback(async (): Promise<ConnectedWallet | null> => {
    if (address && status === "connected") {
      return {
        address,
        walletNetwork,
        walletPassphrase,
        ...signerFor(address),
      };
    }
    return connect();
  }, [address, status, walletNetwork, walletPassphrase, connect]);

  const disconnect = useCallback(() => {
    // Forgets the address locally. Freighter exposes no web "disconnect", so
    // anything stronger would be a lie; the next connect re-reads the address.
    setAddress(null);
    setWalletNetwork(null);
    setWalletPassphrase(null);
    setError(null);
    setStatus("disconnected");
  }, []);

  const value = useMemo<WalletValue>(
    () => ({
      status,
      address,
      walletNetwork,
      walletPassphrase,
      error,
      connect,
      ensureConnected,
      disconnect,
    }),
    [status, address, walletNetwork, walletPassphrase, error, connect, ensureConnected, disconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}
