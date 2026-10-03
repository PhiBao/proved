/** Where each network's deployment is recorded. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const FILE = join(repo, "deployments.json");

export function loadDeployments() {
  if (!existsSync(FILE)) return {};
  return JSON.parse(readFileSync(FILE, "utf8"));
}

export function resolveContractId(network) {
  const fromEnv =
    process.env[`PROVED_CONTRACT_${network.toUpperCase()}`] ?? process.env.PROVED_CONTRACT;
  if (fromEnv) return fromEnv;
  const rec = loadDeployments()[network];
  if (rec?.contractId) return rec.contractId;
  throw new Error(
    `no contract recorded for ${network}. Run: pnpm run deploy:${network}`,
  );
}

export function recordDeployment(network, record) {
  const all = loadDeployments();
  all[network] = { ...(all[network] ?? {}), ...record, recordedAt: new Date().toISOString() };
  writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n");
  return all[network];
}
