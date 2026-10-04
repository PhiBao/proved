/**
 * The demo, executed against a live network.
 *
 * Two jobs:
 *   A. verified delivery  -> money moves with no approval step
 *   B. a dispute          -> the $1.80 bond, against a $337.50 flat fee
 *
 * Then the attack that this product exists to stop: try to claw back job A.
 *
 *   node scripts/demo.mjs --network testnet
 */
import { getNetwork, networkName, fmt } from "./networks.mjs";
import { testnetIdentities } from "./keys.mjs";
import { ensureFunded } from "./fund.mjs";
import { sacIdForAsset } from "./deploy.mjs";
import { Proved, commitment, decimalsOf, ensureTrustline, mint } from "./chain.mjs";
import { resolveContractId } from "./deployments.mjs";

// Job ids are unique per run — ids are single-use by design, which is what makes
// fulfillment non-replayable. The delivery commitments below are deliberately
// fixed, because those are what a real client would pin at funding time.
const RUN = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const JOB_A = `job-alpha-${RUN}`;
const JOB_B = `job-bravo-${RUN}`;

function rule(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m\n${"-".repeat(title.length)}`);
}

function line(k, v) {
  console.log(`  ${k.padEnd(22)} ${v}`);
}

async function main() {
  const netName = networkName();
  const net = getNetwork(netName);
  const keys = testnetIdentities();
  const contractId = resolveContractId(netName);

  const issuer = keys.issuer;
  const client = keys.client;
  const freelancer = keys.freelancer;
  const challenger = keys.challenger;

  const assetCode = netName === "testnet" ? "PUSD" : "USDC";
  const asset =
    netName === "testnet"
      ? sacIdForAsset(assetCode, issuer.publicKey(), netName)
      : net.usdc;

  // Money is expressed in whole units of whatever asset this deployment settles
  // in. USDC is 6-decimal; a classic Stellar asset is always 7-decimal, so a
  // self-minted testnet asset does not match USDC to the last decimal. The
  // contract reads the asset's own precision rather than assuming one.
  const dec = await decimalsOf(net, asset);
  const one = 10n ** BigInt(dec);
  const usd = (whole, cents = 0n) => Number(whole * one + cents * (one / 100n));
  const money = (stroops) => fmt(stroops, dec);

  rule("Proved — live on " + net.label);
  line("contract", contractId);
  line("settles in", `${assetCode} (SAC ${asset})`);
  line("explorer", net.explorerContract(contractId));

  if (netName === "testnet") {
    for (const kp of [issuer, client, freelancer, challenger]) {
      await ensureFunded(net, kp.publicKey());
    }
  }

  // Give the actors the asset. On mainnet the operator pre-funds instead.
  if (netName === "testnet") {
    rule("Funding");
    // Every participant needs the settlement asset. The freelancer needs it too:
    // their reputation-charged stake is transferred *into* the contract at
    // funding time, so they have to be able to cover it.
    for (const [role, kp] of Object.entries({
      client,
      challenger,
      freelancer,
    })) {
      if (await ensureTrustline(net, kp, assetCode, issuer)) {
        line(role, "trustline opened");
      }
      await mint(net, asset, issuer, kp, usd(5000n));
      line(role, `minted 5,000.00 ${assetCode}`);
    }
  }

  const p = new Proved({ net, contractId, keys });
  await p.setStartLedger();


  // --------------------------------------------------------------- pricing --
  rule("The cost curve");
  line("asset precision", `${dec} decimals`);
  const amount = usd(1200n);
  const bond = await p.read("challenge_bond_for", { amount });
  const stakeNew = await p.read("stake_for", { freelancer: freelancer.publicKey(), amount });
  const stakeFre = await p.read("stake_bps", { freelancer: freelancer.publicKey() });
  line("job amount", `1,200.00 ${assetCode}`);
  line("challenge bond", `${money(bond)} ${assetCode}  (0.15%, floor 1.00)`);
  line("Upwork flat fee", `337.50 — the same dispute, for anyone`);
  const flatFee = 337n * one + one / 2n; // $337.50
  line("ratio", `${(Number(flatFee) / Number(bond)).toFixed(0)}x cheaper to contest`);
  line("this freelancer", `${stakeFre} bps -> stake ${money(stakeNew)} ${assetCode}`);

  // ------------------------------------------------------- job A: delivered --
  rule("Job A — verified delivery");
  const condA = commitment("design-final-v3.zip");
  const jobA = commitment(JOB_A);

  const opened = await p.write(
    "open",
    {
      id: jobA,
      freelancer: freelancer.publicKey(),
      client: client.publicKey(),
      amount,
      condition_hash: condA,
      deliver_by: Math.floor(Date.now() / 1000) + 86_400,
    },
    client,
    [freelancer],
  );
  line("funded", net.explorerTx(opened.hash));
  line("state after funding", `${await p.read("state", { id: jobA })} (1 = open)`);

  const t0 = Date.now();
  const released = await p.write("submit", { id: jobA, artifact_hash: condA }, freelancer);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  line("delivered", "artifact matched the funding-time commitment");
  line("paid in", `${secs}s — no approve step, no review window`);
  line("tx", net.explorerTx(released.hash));
  line("state", `${await p.read("state", { id: jobA })} (2 = released, terminal)`);
  line("is_final", String(await p.read("is_final", { id: jobA })));

  const rep = await p.read("reputation", { who: freelancer.publicKey() });
  line("freelancer record", `completed=${rep[0]} onTime=${rep[1]} lost=${rep[2]} won=${rep[3]}`);

  // ------------------------------------------------------- job B: disputed --
  rule("Job B — a dispute, for $1.80");
  const condB = commitment("homepage-mockup.fig");
  const jobB = commitment(JOB_B);
  const bad = commitment("homepage-mockup-DRAFT.fig");

  const openedB = await p.write(
    "open",
    {
      id: jobB,
      freelancer: freelancer.publicKey(),
      client: challenger.publicKey(),
      amount,
      condition_hash: condB,
      deliver_by: Math.floor(Date.now() / 1000) + 86_400,
    },
    challenger,
    [freelancer],
  );
  line("funded", net.explorerTx(openedB.hash));

  await p.write("submit", { id: jobB, artifact_hash: bad }, freelancer);
  line("delivered", "artifact does NOT match the commitment");
  line("state", `${await p.read("state", { id: jobB })} (1 = open — money still held)`);

  const t1 = Date.now();
  const ch = await p.write("challenge", { id: jobB, reason_hash: commitment("wrong-file-delivered") }, challenger);
  const posted = (await p.read("job", { id: jobB })).challenge_bond;
  line(
    "client challenged",
    `posted ${money(posted)} ${assetCode} in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
  );
  line("tx", net.explorerTx(ch.hash));
  line("state", `${await p.read("state", { id: jobB })} (3 = challenged)`);

  const cf = await p.write("confirm", { id: jobB }, challenger);
  const csecs = ((Date.now() - t1) / 1000).toFixed(1);
  line("adjudicated", `in ${csecs}s total, by contract, no human`);
  line("tx", net.explorerTx(cf.hash));
  line("state", `${await p.read("state", { id: jobB })} (4 = settled, client refunded)`);
  const repB = await p.read("reputation", { who: freelancer.publicKey() });
  line("freelancer record", `completed=${repB[0]} onTime=${repB[1]} lost=${repB[2]} won=${repB[3]}`);

  // -------------------------------------------- the attack this product stops --
  rule("Can job A be clawed back?");
  for (const [label, attempt] of [
    ["client challenges", () => p.write("challenge", { id: jobA, reason_hash: commitment("changed-my-mind") }, client)],
    ["freelancer re-submits", () => p.write("submit", { id: jobA, artifact_hash: bad }, freelancer)],
    ["anyone tries to expire it", () => p.write("expire", { id: jobA }, client)],
  ]) {
    try {
      await attempt();
      console.log(`  ${label.padEnd(22)} UNEXPECTEDLY SUCCEEDED`);
    } catch (e) {
      const msg = String(e.message).split("\n").slice(0, 3).join(" ").slice(0, 150);
      console.log(`  ${label.padEnd(22)} refused — ${msg}`);
    }
  }
  line("state still", `${await p.read("state", { id: jobA })} (2 = released, irreversible)`);

  // ------------------------------------------------------------- attestation --
  rule("Portable proof — from chain state, no login");
  const att = await p.read("attestation", { id: jobA });
  line("freelancer", att[0]);
  line("amount", `${money(att[1])} ${assetCode}`);
  line("delivered", String(att[2]));
  line("state", String(att[3]));

  rule("Done");
  line("contract", contractId);
  // Full ids, not truncated. The truncation was fine when this was only for the
  // eye, but these ids are copied into the site's pre-filled job field and the
  // README, where 16 characters is a job that cannot be found.
  line("job A", Buffer.from(jobA).toString("hex"));
  line("job B", Buffer.from(jobB).toString("hex"));
  console.log();
}

main().catch((e) => {
  console.error("\n\x1b[31mdemo failed\x1b[0m\n" + (e.stack || e.message));
  process.exit(1);
});
