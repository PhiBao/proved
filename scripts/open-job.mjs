/**
 * Open one job, signed by both parties, and print the job id.
 *
 * Used by scripts/demo.mjs and by the web app's demo-mode route, so there is one
 * implementation of "a payer funds and a worker accepts" rather than two that
 * can drift.
 *
 *   node scripts/open-job.mjs --description homepage.fig --amount 1200 --worker freelancer
 */
import { contract } from "@stellar/stellar-sdk";
import { getNetwork } from "./networks.mjs";
import { testnetIdentities } from "./keys.mjs";
import { Proved, commitment, decimalsOf } from "./chain.mjs";
import { resolveContractId } from "./deployments.mjs";
import { sacIdForAsset } from "./deploy.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export async function openJob({
  description,
  amount,
  worker = "freelancer",
  netName = "testnet",
}) {
  const net = getNetwork(netName);
  const contractId = resolveContractId(netName);
  const keys = testnetIdentities();
  const client = keys.client;
  const freelancer = keys.freelancer;

  const asset = netName === "testnet" ? sacIdForAsset("PUSD", keys.issuer.publicKey(), netName) : net.usdc;
  const decimals = await decimalsOf(net, asset);
  const one = 10n ** BigInt(decimals);

  const p = new Proved({ net, contractId, keys });
  const jobId = commitment(`job-${description}-${Date.now()}`);
  const condition = commitment(description);

  const res = await p.write(
    "open",
    {
      id: jobId,
      freelancer: freelancer.publicKey(),
      client: client.publicKey(),
      amount: BigInt(amount) * one,
      condition_hash: condition,
      deliver_by: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    },
    client,
    [freelancer],
  );

  return {
    jobId: Buffer.from(jobId).toString("hex"),
    txHash: res.hash,
    conditionHex: Buffer.from(condition).toString("hex"),
    stake: (await p.read("stake_for", {
      freelancer: freelancer.publicKey(),
      amount: BigInt(amount) * one,
    })),
    decimals,
    worker,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const description = arg("description", "homepage-mockup.fig");
  const amount = arg("amount", "1200");
  const worker = arg("worker", "freelancer");

  openJob({ description, amount, worker })
    .then((r) => {
      if (process.env.PROVED_JOBS_ONLY === "1") {
        // The web route wants the bare id on stdout.
        console.log(r.jobId);
      } else {
        console.log(`job id     ${r.jobId}`);
        console.log(`commitment ${r.conditionHex}`);
        console.log(`worker     ${r.worker} (stake ${r.stake})`);
        console.log(`tx         ${r.txHash}`);
        console.log(`\n/j/${r.jobId}?as=client`);
      }
    })
    .catch((e) => {
      console.error(String(e.stderr || e.message || e));
      process.exit(1);
    });
}

export { contract };
