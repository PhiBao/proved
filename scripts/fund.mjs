/**
 * Fund testnet accounts and open the settlement asset on them.
 *
 * Testnet only. Mainnet accounts must already exist and be funded by the
 * operator; this script refuses to touch mainnet rather than risk sending real
 * XLM anywhere.
 *
 * Friendbot is rate-limited, so accounts are funded on demand rather than all at
 * once, and already-funded accounts are skipped.
 */
import { Asset } from "@stellar/stellar-sdk";
import { getNetwork } from "./networks.mjs";
import { testnetIdentities, loadIdentities } from "./keys.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function accountExists(horizonUrl, pub) {
  const res = await fetch(`${horizonUrl}/accounts/${encodeURIComponent(pub)}`);
  return res.ok;
}

/** Fund with test XLM via friendbot, if not already funded. */
export async function ensureFunded(net, pub, log = console.log) {
  if (await accountExists(net.horizonUrl, pub)) {
    log(`  ${pub.slice(0, 8)}…  already funded`);
    return false;
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`${net.friendbotUrl}/?addr=${encodeURIComponent(pub)}`);
    if (res.ok) {
      log(`  ${pub.slice(0, 8)}…  funded`);
      return true;
    }
    // friendbot answers 400 with a rate-limit detail; back off and retry.
    await sleep(1200 * attempt);
  }
  throw new Error(`friendbot would not fund ${pub}`);
}

/**
 * Give an account a trustline for the classic asset whose Stellar Asset Contract
 * wraps it. Required before it can hold the settlement token. CAP-73 lets a
 * Soroban flow create this classic account automatically, but doing it explicitly
 * keeps the demo legible.
 */
export async function ensureAssetHolder(net, issuerKp, holderKp, assetCode) {
  const res = await fetch(
    `${net.horizonUrl}/accounts/${encodeURIComponent(holderKp.publicKey())}`,
  );
  if (res.ok) {
    const acct = await res.json();
    const has = acct.balances?.some(
      (b) => b.asset_code === assetCode && b.asset_issuer === issuerKp.publicKey(),
    );
    if (has) return false;
  }
  return true; // caller performs the changeTrust
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const netName = (process.argv.includes("--network")
    ? process.argv[process.argv.indexOf("--network") + 1]
    : "testnet");
  if (netName !== "testnet") {
    console.error("refusing to fund on a non-testnet network");
    process.exit(1);
  }
  const net = getNetwork("testnet");
  console.log("Funding testnet accounts via friendbot:");
  for (const [role, kp] of Object.entries(testnetIdentities())) {
    await ensureFunded(net, kp.publicKey());
    await sleep(250);
  }
  // keep the keyfile in sync with the canonical derivation
  loadIdentities();
  console.log("done");
}
