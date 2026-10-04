"use client";

/**
 * Which network the site is looking at.
 *
 * Both networks are deployed and both are reachable, so the choice is the
 * viewer's rather than the build's. It lives in a context so the header, the
 * footer and every page agree without threading a prop through the tree, and it
 * is mirrored into the URL as `?net=` so a link to a mainnet job can be shared
 * and mean the same thing on someone else's screen.
 *
 * The build's `NEXT_PUBLIC_NETWORK` is only the default. Reading it directly
 * would have meant the only way to see mainnet was to redeploy the site, which
 * is a strange thing to require of a contract that is already live there.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ClientConfig } from "./client-config";
import type { Network } from "./proved";

interface NetworkValue {
  network: Network;
  config: ClientConfig;
  configs: Record<Network, ClientConfig>;
  setNetwork: (n: Network) => void;
}

const Ctx = createContext<NetworkValue | null>(null);

export const NETWORKS: Network[] = ["mainnet", "testnet"];

function readInitial(defaults: Record<Network, ClientConfig>): Network {
  if (typeof window === "undefined") return defaults.mainnet ? "mainnet" : "testnet";
  const fromUrl = new URLSearchParams(window.location.search).get("net");
  if (fromUrl === "mainnet" || fromUrl === "testnet") return fromUrl;
  const stored = window.localStorage.getItem("proved:net");
  if (stored === "mainnet" || stored === "testnet") return stored;
  return "mainnet";
}

export function NetworkProvider({
  configs,
  children,
}: {
  configs: Record<Network, ClientConfig>;
  children: React.ReactNode;
}) {
  // Render the default on both sides of hydration, then correct on the client.
  // Reading localStorage during render would make the first paint depend on it
  // and produce a hydration mismatch instead of a network switch.
  const [network, setNetworkState] = useState<Network>("mainnet");

  useEffect(() => {
    const initial = readInitial(configs);
    setNetworkState(initial);
    // Drop any ?net= once it has been honoured, so the URL a viewer copies is
    // the canonical one and the parameter does not accumulate on navigation.
    if (new URLSearchParams(window.location.search).has("net")) {
      const u = new URL(window.location.href);
      u.searchParams.delete("net");
      window.history.replaceState(null, "", u.toString());
    }
  }, [configs]);

  const setNetwork = useCallback((n: Network) => {
    setNetworkState(n);
    try {
      window.localStorage.setItem("proved:net", n);
    } catch {
      // A browser with storage disabled still gets a working switch for the
      // session; it just forgets on reload.
    }
  }, []);

  const value = useMemo<NetworkValue>(
    () => ({ network, config: configs[network], configs, setNetwork }),
    [network, configs, setNetwork],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNetwork(): NetworkValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNetwork must be used inside <NetworkProvider>");
  return v;
}