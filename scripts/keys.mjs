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
import { createHash, pbkdf2Sync } from "node:crypto";
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
 *
 * The environment value may be either a `S…` secret key or a BIP-39 mnemonic.
 * Seed phrases are the more common way a hardware-wallet user exports a mainnet
 * account, and silently trying to parse one as a secret key fails with a
 * baffling "invalid secret key length", so the shape is detected explicitly.
 */
export function keypairFor(role, network) {
  if (network === "mainnet") {
    const raw = process.env[`${role.toUpperCase()}_SECRET`] ?? process.env.DEPLOYER_SECRET;
    if (!raw) {
      throw new Error(
        `mainnet deployment needs ${role.toUpperCase()}_SECRET (or DEPLOYER_SECRET) in the environment`,
      );
    }
    return keypairFromEnv(raw);
  }
  const ids = loadIdentities();
  if (!ids.secret?.[role]) throw new Error(`no testnet key for role "${role}"`);
  return Keypair.fromSecret(ids.secret[role]);
}

/**
 * Build a keypair from a `S…` secret or a 12/24-word BIP-39 mnemonic.
 *
 * The SDK v17 exposes no `fromMnemonic`, so BIP-39 is implemented here:
 * PBKDF2-HMAC-SHA512 over the mnemonic with salt `"mnemonic" + passphrase`,
 * 2048 iterations, 64 bytes out, and the first 32 are the ed25519 seed.
 *
 * @param {string} raw
 * @param {string} [passphrase] BIP-39 passphrase, if the seed uses one
 */
export function keypairFromEnv(raw, passphrase = "") {
  const value = raw.trim();
  if (value.startsWith("S")) return Keypair.fromSecret(value);

  const words = value.split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(
      `expected a Stellar secret key (S…) or a 12/24-word BIP-39 mnemonic; got ` +
        `${words.length} tokens. If this is a passphrase rather than a mnemonic, ` +
        `use Keypair.fromRawEd25519Seed(sha256(passphrase)).`,
    );
  }
  const seed = bip39Seed(words.join(" "), passphrase);
  return Keypair.fromRawEd25519Seed(seed.subarray(0, 32));
}

/** BIP-39 seed derivation: 64 bytes from the mnemonic and an optional passphrase. */
export function bip39Seed(mnemonic, passphrase = "") {
  return pbkdf2Sync(
    Buffer.from(mnemonic.normalize("NFKD"), "utf8"),
    Buffer.from(`mnemonic${passphrase.normalize("NFKD")}`, "utf8"),
    2048,
    64,
    "sha512",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = writeTestnetIdentities();
  console.log("Wrote", identitiesPath());
  console.table(payload.public);
}
