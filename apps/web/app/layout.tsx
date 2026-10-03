import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { contractId, networkConfig, networkFromEnv } from "@/lib/proved";

export const metadata: Metadata = {
  title: "Proved — paid on proof",
  description:
    "Settlement where cross-border freelancers are paid the instant their work is verifiably delivered, and disputing costs cents instead of $337.50.",
};

export const viewport: Viewport = {
  themeColor: "#fdf8f0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const n = networkFromEnv();
  const net = networkConfig(n);
  let cid = "";
  try {
    cid = contractId(n);
  } catch {
    cid = "";
  }

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="border-b" style={{ borderColor: "var(--line)" }}>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold tracking-tight">Proved</span>
              <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                paid on proof
              </span>
            </Link>
            <span className="pill pill-open mono" title={net.label}>
              {n}
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">{children}</main>

        <footer
          className="border-t px-5 py-6 text-xs"
          style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }}
        >
          <div className="mx-auto max-w-3xl space-y-1.5">
            <p>
              Soroban contract{" "}
              {cid ? (
                <a className="link mono" href={net.explorerContract(cid)} target="_blank" rel="noreferrer">
                  {cid.slice(0, 8)}…
                </a>
              ) : (
                <span className="mono">not configured</span>
              )}
              {n === "testnet" && " · testnet, not audited, no real value"}
            </p>
            <p>
              Dispute costs 0.15% of the job amount, floor 1.00. Upwork charges{" "}
              <span className="mono">$337.50</span> flat, for anyone.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
