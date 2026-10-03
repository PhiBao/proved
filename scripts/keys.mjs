/**
 * Deterministic identities.
 *
 * Testnet keys are derived from fixed, hard-coded seeds and committed to the
 * repo on purpose: a judge should be able to clone and reproduce the whole demo
 * without asking anyone for a secret. They hold no value and control nothing.
 *
 * Mainnet keys are never written to disk by this script. `DEPLOYER_SECRET` is
 * supplied through the environment only.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/** Roles used by the demo. Order is stable so the video is reproducible. */
export const ROLES = [
  "issuer", // mints the testnet settlement asset
  "client", // pays for work
  "freelancer", // does the work
  "challenger", // a second client, used for the dispute branch
  "observer", // read-only, proves the public proof page needs no account
];

/** Hard-coded, publicly-known seeds. Testnet only. */
const TESTNET_SEEDS = {
  issuer: "proved testnet issuer alpha",
  client: "proved testnet client bravo",
  freelancer: "proved testnet freelancer charlie",
  challenger: "proved testnet challenger delta",
  observer: "proved testnet observer echo",
};

export function testnetIdentities() {
  const out = {};
  for (const role of ROLES) {
    // sha256 gives exactly the 32 bytes an ed25519 seed needs, and makes the
    // keys reproducible from the labels alone.
    const seed = createHash("sha256").update(TESTNET_SEEDS[role]).digest();
    out[role] = Keypair.fromRawEd25519Seed(seed);
  }
  return out;
}

export function identitiesPath() {
  return join(repo, "scripts", "identities.testnet.json");
}

/** Write the committed testnet keyfile. Safe: these keys control nothing. */
export function writeTestnetIdentities() {
  const ids = testnetIdentities();
  const payload = {
    _warning:
      "TESTNET KEYS ONLY — derived from public, hard-coded seeds and committed " +
      "deliberately so the demo is reproducible by anyone who clones this repo. " +
      "They hold no value. Never put a mainnet secret in this file.",
    public: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.publicKey()])),
    secret: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.secret()])),
  };
  writeFileSync(identitiesPath(), JSON.stringify(payload, null, 2) + "\n");
  return payload;
}

export function loadIdentities() {
  const p = identitiesPath();
  if (!existsSync(p)) return writeTestnetIdentities();
  return JSON.parse(readFileSync(p, "utf8"));
}

/**
 * Resolve the keypair for a role.
 * Testnet: the committed keyfile. Mainnet: DEPLOYER_SECRET / ROLE_SECRET env.
 */
export function keypairFor(role, network) {
  if (network === "mainnet") {
    const envKey = process.env[`${role.toUpperCase()}_SECRET`] ?? process.env.DEPLOYER_SECRET;
    if (!envKey) {
      throw new Error(
        `mainnet deployment needs ${role.toUpperCase()}_SECRET (or DEPLOYER_SECRET) in the environment`,
      );
    }
    return Keypair.fromSecret(envKey);
  }
  const ids = loadIdentities();
  if (!ids.secret?.[role]) throw new Error(`no testnet key for role "${role}"`);
  return Keypair.fromSecret(ids.secret[role]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = writeTestnetIdentities();
  console.log("Wrote", identitiesPath());
  console.table(payload.public);
}
