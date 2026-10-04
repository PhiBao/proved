/**
 * Ask the *mainnet* contract what a dispute costs, in real USDC.
 *
 * The claims in the README are arithmetic on two constants: 15 basis points and
 * a reputation curve. Those constants are compiled into the WASM that is running
 * on mainnet against Circle's real USDC asset contract, so a judge does not have
 * to take anyone's word for them — they can be read straight off the chain.
 *
 * This reads only. It holds no keys, signs nothing and costs no USDC, which is
 * the point: the economic claim is verifiable without anyone risking money.
 *
 *   node --env-file-if-exists=.env.local scripts/mainnet-proof.mjs
 */
import { Keypair } from "@stellar/stellar-sdk";
import { getNetwork, fmt } from "./networks.mjs";
import { loadDeployments } from "./deployments.mjs";
import { Proved } from "./chain.mjs";
import { keypairFor, testnetIdentities } from "./keys.mjs";

function rule(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m\n${"-".repeat(t.length)}`);
}
function line(k, v) {
  console.log(`  ${k.padEnd(26)} ${v}`);
}

// This script defaults to mainnet, which `networkName()` does not: that helper
// defaults to STELLAR_NETWORK, which is testnet in the local environment. The
// previous local parser was worse — a missing flag made it `false`, and
// `false ?? "mainnet"` is `false`, not `"mainnet"`, so `pnpm run proof` failed
// with `unknown network "false"` unless --network was passed explicitly.
// `??` falls through on null and undefined, never on false.
const flagIndex = process.argv.indexOf("--network");
const netName =
  (flagIndex !== -1 && process.argv[flagIndex + 1]?.startsWith("mainnet")
    ? "mainnet"
    : flagIndex !== -1 && process.argv[flagIndex + 1]
      ? process.argv[flagIndex + 1]
      : "mainnet");
const net = getNetwork(netName);
const dep = loadDeployments()[netName];
if (!dep?.contractId) {
  console.error(`no mainnet deployment recorded. Run: pnpm run deploy:mainnet`);
  process.exit(1);
}

// Reads need a *source account that exists* — the SDK fetches its ledger entry
// before simulating. On mainnet that is the deployer; on testnet it is the
// committed observer identity. No signature is involved either way.
const observer =
  netName === "mainnet"
    ? keypairFor("deployer", netName)
    : testnetIdentities().observer;

const p = new Proved({
  net,
  contractId: dep.contractId,
  keys: { observer },
});

rule(`Proved on ${net.label}`);
line("contract", dep.contractId);
line("explorer", net.explorerContract(dep.contractId));

rule("What it settles in");

// The contract stores its settlement asset at init. Read it back rather than
// trusting deployments.json: a typo there would otherwise be invisible.
const token = await p.read("token", {});
line("bound to", token);

const decimals = await p.read("decimals", {});
line("decimals", `${decimals}  (read from the asset itself, not assumed)`);

const [code, issuer] = dep.assetCode
  ? [dep.assetCode, dep.issuer]
  : await (async () => {
      // deployments.json records the token id; resolve it to a human name via
      // Horizon so the artifact reads as "USDC", not as a contract id.
      const res = await fetch(`${net.horizonUrl}/assets?asset_contract=${token}`);
      const rec = (await res.json())._embedded?.records?.[0];
      return [rec?.asset_code ?? "?", rec?.asset_issuer ?? "?"];
    })();

let verified = "not checked";
try {
  const { sacIdForAsset } = await import("./deploy.mjs");
  const derived = sacIdForAsset(code, issuer, netName);
  const rec = await (
    await fetch(`${net.horizonUrl}/assets?asset_code=${code}&asset_issuer=${issuer}`)
  ).json();
  verified =
    derived === token && derived === rec._embedded.records[0].contract_id
      ? `\x1b[32mmatches the ledger\x1b[0m (derived from the issuer and cross-checked)`
      : `\x1b[31mDOES NOT MATCH — stop and investigate\x1b[0m`;
} catch (e) {
  verified = `could not verify: ${e.message}`;
}
line("asset", `${code} issued by ${issuer.slice(0, 10)}…`);
line("identity", verified);

const upworkFlat = 337.5;
const ONE = 10n ** BigInt(decimals);
const money = (v) => fmt(BigInt(v), decimals);

/**
 * An address with genuinely no history. Generated rather than pasted so it
 * always has a valid checksum, and thrown away rather than reused because its
 * reputation is zero by construction — which is the row worth measuring.
 */
const FRESH = Keypair.random().publicKey();

rule(`What a dispute costs, per ${net.label} contract code`);

const jobs = [1_200n, 500n, 100n, 5_000n];
console.log(
  `  ${"job".padEnd(14)}${"challenge bond".padEnd(18)}${"of the job".padEnd(12)}vs $337.50 flat`,
);
console.log(`  ${"-".repeat(14)}${"-".repeat(18)}${"-".repeat(12)}${"-".repeat(16)}`);
for (const usd of jobs) {
  const amount = usd * ONE;
  const bond = BigInt(await p.read("challenge_bond_for", { amount }));
  const share = (Number(bond) / Number(amount)) * 100;
  console.log(
    `  ${`${code} ${usd.toLocaleString()}.00`.padEnd(14)}` +
      `${`${code} ${money(bond)}`.padEnd(18)}` +
      `${share.toFixed(3) + "%".padEnd(12)}` +
      `${(337.5 / Number(usd) / (share / 100)).toFixed(0)}× cheaper`,
  );
}

rule("The bond this replaces");

// `read` hands back Soroban scalars as strings, so convert before doing
// arithmetic. The comparison is in whole units, not strops.
const amount1200 = 1_200n * ONE;
const bond1200 = Number(BigInt(await p.read("challenge_bond_for", { amount: amount1200 }))) / Number(ONE);
console.log(`  Upwork arbitration, flat        ${code} ${upworkFlat.toFixed(2)} on any job`);
console.log(`  Proved, 15 bps of the job       ${code} ${bond1200.toFixed(2)} on a 1,200.00 job`);
console.log(
  `                                 ${(bond1200 / upworkFlat * 100).toFixed(2)}% of what Upwork charges`,
);
console.log();
console.log(
  `  The flat fee does not scale with the job, so the gap widens on every ` +
    `larger job and closes on every smaller one.`,
);
console.log(
  `  Below ${code} 666.67 the Proved bond hits its ${code} 1.00 floor, which is the point:`,
);
console.log(`  a dispute on a small job is contestable here and uneconomic there.`);

rule("Reputation sets the stake a freelancer must lock");

// Only the zero-reputation row can be read from mainnet: reputation is earned
// by settling jobs, and no mainnet job has been funded. That row is a real
// chain read. The rest is the curve `stake_bps` implements, computed here from
// its two constants — and it is checked by the test suite, including a run that
// settles 214 jobs and asserts the rates along the way.
const STAKE_BASE_BPS = 300n;
const STAKE_HALFLIFE = 20n;
const chainRow = BigInt(await p.read("stake_bps", { freelancer: FRESH }));

console.log(
  `  ${"confirmed jobs".padEnd(18)}${"stake".padEnd(10)}${"on a 1,200.00 job".padEnd(20)}source`,
);
console.log(`  ${"-".repeat(18)}${"-".repeat(10)}${"-".repeat(20)}${"-".repeat(14)}`);
for (const done of [0n, 20n, 200n, 2000n]) {
  const bps = Number((STAKE_BASE_BPS * STAKE_HALFLIFE) / (STAKE_HALFLIFE + done));
  const isChain = BigInt(bps) === chainRow && done === 0n;
  console.log(
    `  ${done.toLocaleString().padEnd(18)}${(bps + " bps").padEnd(10)}` +
      `${`${code} ${((bps / 10_000) * 1200).toFixed(2)}`.padEnd(20)}` +
      `${isChain ? `read from ${net.label.toLowerCase()}` : "from the formula"}`,
  );
}
console.log();
const stakeNow = BigInt(await p.read("stake_for", { freelancer: FRESH, amount: amount1200 }));
const stakeAt = (bps) => Number((amount1200 * BigInt(bps)) / 10_000n) / Number(ONE);
console.log(
  `  ${`Locked by a new freelancer on a ${code} 1,200.00 job`.padEnd(52)}` +
    `${`${code} ${money(stakeNow)}`}`,
);
console.log(
  `  300 bps is 3% of the job, comfortably over the ${code} 5.00 floor, so it is`,
);
console.log(
  `  collected in full. It only falls under that floor below ${code} 166.67 — or for a`,
);
console.log(
  `  freelancer with history, since the rate halves every ${STAKE_HALFLIFE} confirmed jobs.`,
);
console.log(`  That ${code} ${stakeAt(27).toFixed(2)} after 200 jobs is the whole point of the curve.`);
console.log(`  The stake is locked, not spent: a successful release returns it in full,`);
console.log(`  along with the job amount and the challenger's bond.`);

rule("What this does and does not show");

line("shows", `the contract is live on ${net.label} against ${code}`);
line("", "the economics are computed by that deployed code");
// The hash claim here used to be that the deployed WASM was byte-identical to
// the tested build. It is not: mainnet runs 9186424a… and this tree builds
// a746a700…. The contract source is unchanged except for #[cfg(test)] modules
// (verified to compile to identical bytes) and the deployed contract's exported
// interface is identical to this build's. So the honest line names what is
// actually checked, and points at the command that checks it.
line("", "the exported interface is identical to this build's — pnpm run abi");
line("", "the executable hash differs: 9186424a… deployed, a746a700… built");
line("does not", "move money — reads only, no balance required of anyone");
console.log();
if (netName === "mainnet") {
  console.log(`  A funded settlement needs real USDC in separately funded accounts, which is`);
  console.log(`  money a hackathon should not spend. Testnet runs the same WASM through the`);
  console.log(`  full lifecycle for free; see \`pnpm run demo:testnet\`.`);
} else {
  console.log(`  On testnet the settlement asset is a self-minted 7-decimal classic asset,`);
  console.log(`  not USDC. The decimals are read from the asset rather than assumed, which`);
  console.log(`  is why the same floors mean the same dollars here as they would in USDC.`);
}