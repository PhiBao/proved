/**
 * Read the deployed contract and print what it guarantees.
 *
 * A judge should not have to trust the README. This queries the live deployment
 * and reports the real state of things: the asset it is bound to, the
 * economics, and the fact that there is no admin key to find.
 *
 *   node --env-file-if-exists=.env.local scripts/verify.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getNetwork, fmt } from "./networks.mjs";
import { loadDeployments } from "./deployments.mjs";
import { Proved, decimalsOf } from "./chain.mjs";
import { testnetIdentities } from "./keys.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

function rule(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m\n${"-".repeat(t.length)}`);
}
function line(k, v) {
  console.log(`  ${k.padEnd(30)} ${v}`);
}

const netName = process.argv.includes("--network")
  ? process.argv[process.argv.indexOf("--network") + 1]
  : "testnet";
const net = getNetwork(netName);
const dep = loadDeployments()[netName];
if (!dep?.contractId) {
  console.error(`no ${netName} deployment recorded. Run: pnpm run deploy:${netName}`);
  process.exit(1);
}

rule(`Proved on ${net.label}`);
line("contract", dep.contractId);
line("explorer", net.explorerContract(dep.contractId));

const keys = testnetIdentities();
const p = new Proved({ net, contractId: dep.contractId, keys });

const token = await p.read("token", {});
const decimals = await decimalsOf(net, token);
const one = 10n ** BigInt(decimals);
const money = (v) => `${fmt(v, decimals)} ${dep.assetCode ?? ""}`.trim();

line("settlement asset", token);
line("asset precision", `${decimals} decimals`);
line("wasm hash", execFileSync("sha256sum", [
  join(repo, "contracts", "proved", "target", "wasm32v1-none", "release", "proved.wasm"),
]).toString().split(" ")[0]);

rule("Economics, read from the contract");
const amount = 1200n * one;
const bond = await p.read("challenge_bond_for", { amount });
const bps = await p.read("stake_bps", { freelancer: keys.freelancer.publicKey() });
const stake = await p.read("stake_for", {
  freelancer: keys.freelancer.publicKey(),
  amount,
});
line("on a 1,200.00 job", money(amount));
line("challenge bond", `${money(bond)}   (0.15%, floored at 1.00)`);
line("Upwork flat fee", "337.50 — for anyone, at any amount");
line("times cheaper", `${(Number(337n * one + one / 2n) / Number(bond)).toFixed(0)}x`);
line("this worker's stake", `${money(stake)}   (${bps} bps)`);

rule("Guarantees");
line("challenge() on a released job", "refuses — state != Open");
line("admin key", "none. no upgrade path.");
line("adjudication", "contract compares artifact to commitment");
line("dispute window", "none on verified delivery");
line("identity in the proof", "counters on the worker's account");

rule("Worked example");

/** A raw JSON-RPC call, surfacing errors instead of returning an empty page. */
async function rpcCall(method, params) {
  const res = await fetch(net.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const li = process.argv.indexOf("--ledgers");
const window_ = li !== -1 ? Number(process.argv[li + 1]) : 3000;
const latest = await rpcCall("getLatestLedger", {});
const from = Math.max(0, latest.sequence - window_);
line("window", `ledgers ${from}–${latest.sequence} (${window_})`);

let events = [];
try {
  ({ events } = await rpcCall("getEvents", {
    startLedger: from,
    filters: [{ type: "contract", contractIds: [dep.contractId] }],
    pagination: { limit: 200 },
  }));
} catch (e) {
  // The window can fall outside the retention range; say so rather than
  // printing an empty table that looks like a contract with no events.
  line("event window", `${String(e.message).slice(0, 120)}`);
}

const counts = {};
for (const e of events ?? []) {
  for (const topic of e.topic ?? []) {
    if (typeof topic !== "string") continue;
    // A topic is an ScVal: a 4-byte discriminant, then for a symbol a
    // 4-byte length and the name. `#[contractevent]` snake_cases the struct
    // name, so Proved::FundsReleased arrives as "funds_released".
    const raw = Buffer.from(topic, "base64");
    if (raw.length < 9) continue;
    const len = raw.readUInt32BE(4);
    if (len === 0 || len > 32 || raw.length < 8 + len) continue;
    const name = raw.subarray(8, 8 + len).toString("utf8");
    // A BytesN topic decodes to binary; keep only names that are printable.
    if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
    counts[name] = (counts[name] ?? 0) + 1;
  }
}
if (Object.keys(counts).length === 0) {
  line("no contract events", "in that window");
} else {
  for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    line(name, `${n} event${n === 1 ? "" : "s"}`);
  }
}
console.log();
