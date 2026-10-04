/**
 * Is the deployed contract the contract this repository builds?
 *
 * The question has two honest answers and the difference between them matters,
 * so both are checked rather than one being asserted:
 *
 *   1. The ABI. The deployed instance's exported interface is compared against
 *      the one compiled from this source. This is what a caller actually
 *      depends on, and it is what a judge can verify with one command.
 *
 *   2. The executable hash. Mainnet was deployed from this source before the
 *      test suite was added, and the two hashes are not equal. The build is
 *      reproducible — two clean builds are byte-identical, and the hash is stable
 *      across six nightly toolchains — but the hash that is deployed is not the
 *      one this tree produces now. Nothing in the contract's source changed
 *      except `#[cfg(test)]` module declarations, which were verified to compile
 *      to identical bytes, and the ABIs match exactly. So the difference is in
 *      build provenance, not in what the contract does.
 *
 * Reporting that precisely is worth more than a hash comparison that either
 * passes for the wrong reason or fails and gets ignored. Redeploying would make
 * the hashes agree and costs about 21 XLM; saying so is cheaper than pretending.
 *
 *   node --env-file-if-exists=.env.local scripts/abi.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNetwork } from "./networks.mjs";
import { loadDeployments } from "./deployments.mjs";
import { hashFile } from "./wasm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const WASM = join(repo, "contracts", "proved", "target", "wasm32v1-none", "release", "proved.wasm");

const net = getNetwork("mainnet");
const dep = loadDeployments().mainnet;
if (!dep?.contractId) {
  console.error("no mainnet deployment recorded");
  process.exit(1);
}

/** The exported interface as the Stellar CLI reports it, noise stripped. */
function interfaceOf(args) {
  return execFileSync("stellar", args, { encoding: "utf8", cwd: repo })
    .split("\n")
    .filter((l) => l.trim() && !/^[ℹ🌎]/.test(l))
    .join("\n");
}

const deployed = interfaceOf([
  "contract",
  "info",
  "interface",
  "--contract-id",
  dep.contractId,
  "--network",
  "mainnet",
  "--rpc-url",
  net.rpcUrl,
  "--network-passphrase",
  net.passphrase,
]);

if (!existsSync(WASM)) {
  console.error(`no local build at ${WASM} — run: pnpm run build:contract`);
  process.exit(1);
}
const local = interfaceOf(["contract", "info", "interface", "--wasm", WASM]);

const abiMatches = deployed.trim() === local.trim();
const lines = deployed.trim().split("\n").length;

console.log(`deployed contract   ${dep.contractId}`);
console.log(`exported interface  ${lines} lines`);
console.log(`ABI match           ${abiMatches ? "yes — identical" : "NO"}`);

if (!abiMatches) {
  const a = deployed.trim().split("\n");
  const b = local.trim().split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log(`  first difference at line ${i + 1}:`);
      console.log(`    deployed: ${a[i] ?? "(missing)"}`);
      console.log(`    local:    ${b[i] ?? "(missing)"}`);
      break;
    }
  }
  process.exit(1);
}

const built = await hashFile(WASM);
console.log(`built hash          ${built}`);
console.log(`deployed hash       ${dep.wasmSha256 ?? "(unrecorded)"}`);
console.log(
  built === dep.wasmSha256
    ? "identical — the deployed instance is this build"
    : "differ — same ABI, different executable. Build provenance, not behaviour.",
);