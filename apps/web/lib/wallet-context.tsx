"use client";

/**
 * Browser-wallet connection state.
 *
 * Signatures are the only thing the browser wallet does here. Reads use a
 * fixed observer address, and testnet demo mode uses committed server keys, so
 * connecting is unnecessary until someone needs to fund, deliver, dispute, or
 * settle. Keeping that state in one context means the header, the posting
 * form, and the job screen cannot disagree about whether a wallet is present.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    freighter?: {
      getPublicKey: () => Promise<string>;
      signTransaction: (xdr: string, opts?: object) => Promise<string>;
    };
  }
}

export type WalletStatus =
  | "checking"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected";

export interface ConnectedWallet {
  address: string;
  signTransaction: (xdr: string) => Promise<string>;
}

interface WalletValue {
  status: WalletStatus;
  address: string | null;
  error: string | null;
  connect: () => Promise<ConnectedWallet | null>;
  ensureConnected: () => Promise<ConnectedWallet | null>;
  disconnect: () => void;
}

const Ctx = createContext<WalletValue | null>(null);

function walletError(): string {
  return "No browser wallet found. Install Freighter to sign, or use testnet demo mode to click through without one.";
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extension wallets can inject after first paint, so availability is checked
  // on mount rather than assumed from the first render.
  useEffect(() => {
    setStatus(typeof window !== "undefined" && window.freighter ? "disconnected" : "unavailable");
  }, []);

  const connect = useCallback(async (): Promise<ConnectedWallet | null> => {
    if (typeof window === "undefined" || !window.freighter) {
      setStatus("unavailable");
      setError(walletError());
      return null;
    }

    setStatus("connecting");
    setError(null);
    try {
      const publicKey = await window.freighter.getPublicKey();
      setAddress(publicKey);
      setStatus("connected");
      return {
        address: publicKey,
        signTransaction: (xdr: string) =>
          window.freighter!.signTransaction(xdr, { alwaysPrompt: false }),
      };
    } catch (e) {
      setStatus("disconnected");
      setError(e instanceof Error ? e.message : "The wallet refused the connection request.");
      return null;
    }
  }, []);

  const ensureConnected = useCallback(async (): Promise<ConnectedWallet | null> => {
    if (address && status === "connected" && window.freighter) {
      return {
        address,
        signTransaction: (xdr: string) =>
          window.freighter!.signTransaction(xdr, { alwaysPrompt: false }),
      };
    }
    return connect();
  }, [address, status, connect]);

  const disconnect = useCallback(() => {
    // This forgets the address locally. Freighter itself has no web disconnect
    // API worth calling; naming it anything stronger would be misleading.
    setAddress(null);
    setError(null);
    setStatus(window.freighter ? "disconnected" : "unavailable");
  }, []);

  const value = useMemo<WalletValue>(
    () => ({ status, address, error, connect, ensureConnected, disconnect }),
    [status, address, error, connect, ensureConnected, disconnect],
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
