import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { allClientConfigs } from "@/lib/proved";
import { NetworkProvider } from "@/lib/network-context";
import { Mark, NetworkSwitch, SiteFooter } from "@/components/SiteChrome";

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
  // Both networks are resolved on the server and handed down, so the browser
  // never reads process.env and a missing variable becomes a build error rather
  // than a blank card at runtime.
  const configs = allClientConfigs();

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <NetworkProvider configs={configs}>
          <header className="border-b" style={{ borderColor: "var(--line)" }}>
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
              <Link href="/" className="flex items-baseline gap-2">
                <Mark />
                <span className="text-[17px] font-bold tracking-tight">Proved</span>
                <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  paid on proof
                </span>
              </Link>
              <NetworkSwitch configs={configs} />
            </div>
          </header>

          <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">{children}</main>

          <SiteFooter />
        </NetworkProvider>
      </body>
    </html>
  );
}