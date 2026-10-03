/**
 * Deploy the Proved contract.
 *
 * The contract build is delegated to `stellar contract build`, because soroban-sdk
 * v28 refuses to produce a loadable Wasm without it. Everything else is driven
 * from the JS SDK so the CLI's human-readable output never has to be parsed.
 *
 *   node scripts/deploy.mjs --network testnet
 *   node scripts/deploy.mjs --network mainnet
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getNetwork, networkName } from "./networks.mjs";
import { recordDeployment } from "./deployments.mjs";
import { keypairFor, testnetIdentities } from "./keys.mjs";
import { ensureFunded } from "./fund.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const WASM = join(repo, "contracts", "proved", "target", "wasm32v1-none", "release", "proved.wasm");

/**
 * Ask the CLI for the Stellar Asset Contract id wrapping a classic asset.
 * Uses the CLI only for this deterministic derivation, which has no client-side
 * equivalent worth hand-rolling.
 */
export function sacIdForAsset(assetCode, issuerPub, network) {
  const r = spawnSync(
    "stellar",
    ["contract", "id", "asset", "--asset", `${assetCode}:${issuerPub}`, "--network", network],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`could not derive SAC id:\n${r.stderr || r.stdout}`);
  }
  const id = (r.stdout || "").match(/C[A-Z2-7]{55}/)?.[0];
  if (!id) throw new Error(`no contract id in CLI output:\n${r.stdout}`);
  return id;
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout || "";
}

/** Build the Wasm. Fails loudly rather than shipping a stale artifact. */
export function buildContract() {
  if (!existsSync(WASM)) {
    run("stellar", ["contract", "build"], {
      STELLAR_NETWORK: undefined,
      cwd: join(repo, "contracts", "proved"),
    });
  }
  if (!existsSync(WASM)) throw new Error(`build produced no wasm at ${WASM}`);
  const bytes = readFileSync(WASM);
  console.log(`  wasm: ${bytes.length} bytes`);
  return WASM;
}

/**
 * Deploy.
 *
 * `token` is the settlement asset's Stellar Asset Contract address and is baked
 * into the contract forever — there is no admin key and no upgrade path.
 */
export async function deploy({ network: netName, token }) {
  const net = getNetwork(netName);
  // Testnet deploys from the committed issuer key; mainnet from DEPLOYER_SECRET.
  const deployer = keypairFor("issuer", netName);
  const wasmPath = buildContract();

  if (netName === "testnet") {
    await ensureFunded(net, deployer.publicKey());
  }

  console.log(`\nDeploying Proved -> ${net.label}`);
  console.log(`  from   ${deployer.publicKey()}`);
  console.log(`  rpc    ${net.rpcUrl}`);
  if (token) console.log(`  asset  ${token}`);

  const out = run("stellar", [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--network",
    netName,
    "--source",
    deployer.secret(),
    "--rpc-url",
    net.rpcUrl,
    "--network-passphrase",
    net.passphrase,
    ...(token ? ["--", "--token", token] : []),
  ]);

  const ids = [...out.matchAll(/C[A-Z2-7]{55}/g)].map((m) => m[0]);
  const contractId = ids[ids.length - 1];
  const txHashes = [...out.matchAll(/\b[0-9a-f]{64}\b/g)].map((m) => m[0]);

  if (!contractId) throw new Error(`could not read contract id from:\n${out}`);
  return { contractId, txHashes, deployer: deployer.publicKey(), network: netName };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const netName = networkName();
  const net = getNetwork(netName);
  let token = net.usdc;

  if (netName === "testnet") {
    // On testnet, settle in an asset we mint ourselves so the demo never depends
    // on a third-party faucet. Mainnet uses real USDC.
    const ids = testnetIdentities();
    const issuer = ids.issuer.publicKey();
    token = process.env.PROVED_TESTNET_ASSET_CONTRACT ?? sacIdForAsset("PUSD", issuer, "testnet");
    console.log(`testnet settlement asset: PUSD:${issuer}\n  SAC ${token}`);
  }

  const res = await deploy({ network: netName, token });
  console.log(`\n✓ contract  ${res.contractId}`);
  console.log(`  explorer  ${net.explorerContract(res.contractId)}`);
  for (const h of res.txHashes) console.log(`  tx        ${net.explorerTx(h)}`);
  recordDeployment(netName, {
    contractId: res.contractId,
    asset: token,
    assetCode: netName === "testnet" ? "PUSD" : "USDC",
    issuer: testnetIdentities().issuer.publicKey(),
  });
  console.log(`\nRecorded in deployments.json`);
}
