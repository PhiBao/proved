/**
 * Walk one job all the way to paid, exactly as the UI would, and print what a
 * person would see at each step. Used to check the demo path stays intact.
 *
 *   node scripts/walk.mjs --description payroll-june.csv --amount 1200
 */
import { getNetwork } from "./networks.mjs";
import { testnetIdentities } from "./keys.mjs";
import { Proved, commitment, decimalsOf } from "./chain.mjs";
import { resolveContractId } from "./deployments.mjs";
import { sacIdForAsset } from "./deploy.mjs";
import { openJob } from "./open-job.mjs";

function arg(name, d) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
}

const net = getNetwork("testnet");
const keys = testnetIdentities();
const description = arg("description", "payroll-june.csv");
const amount = arg("amount", "1200");
const asset = sacIdForAsset("PUSD", keys.issuer.publicKey(), "testnet");
const decimals = await decimalsOf(net, asset);
const one = 10n ** BigInt(decimals);
const money = (v) => (BigInt(v) / one).toString() + "." + (BigInt(v) % one).toString().padStart(decimals, "0");

const opened = await openJob({ description, amount, worker: "freelancer" });
const jobId = Buffer.from(opened.jobId, "hex");
const condition = Buffer.from(opened.conditionHex, "hex");
const p = new Proved({ net, contractId: resolveContractId("testnet"), keys });

console.log(`job      ${opened.jobId}`);
console.log(`payer    ${keys.client.publicKey()}`);
console.log(`worker   ${keys.freelancer.publicKey()}`);
console.log(`amount   ${money(BigInt(amount) * one)}`);
console.log(`stake    ${money(opened.stake)}   <- locked by the worker at funding`);
console.log(`state    ${await p.read("state", { id: jobId })} (1 = awaiting delivery)`);

const t0 = Date.now();
const rel = await p.write("submit", { id: jobId, artifact_hash: condition }, keys.freelancer);
console.log(`\nworker delivered "${description}" -> hash matched`);
console.log(`paid in  ${((Date.now() - t0) / 1000).toFixed(1)}s, no approve step`);
console.log(`tx       ${rel.hash}`);
console.log(`state    ${await p.read("state", { id: jobId })} (2 = paid)`);
console.log(`final    ${await p.read("is_final", { id: jobId })}`);
console.log(`\nUI: /j/${opened.jobId}?as=freelancer`);
console.log(`UI: /proof/${opened.jobId}`);
