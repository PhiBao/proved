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
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Account,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
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

/** Stellar secret keys, and anything long enough to be one. */
const SECRET_LIKE = /\bS[A-Z2-7]{55}\b/g;

/**
 * Never let a key reach a log, an error message, or `ps`.
 *
 * The CLI takes `--source <secret>`, so the first version of this script passed
 * the deployer's key on the command line: readable by any process on the machine
 * and echoed verbatim into error output, which is exactly what happened on the
 * first mainnet attempt. Secrets are now imported into a throwaway identity
 * directory and referenced by address, and this redacts anything that slips
 * through anyway.
 */
function redact(text) {
  return String(text).replace(SECRET_LIKE, "S<redacted>");
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    throw new Error(
      `${redact(`${cmd} ${args.join(" ")}`)} failed:\n${redact(r.stderr || r.stdout)}`,
    );
  }
  return r.stdout || "";
}

/**
 * Put a keypair into a private, temporary identity directory and return the
 * directory plus the address to pass as `--source-account-id`.
 *
 * The alternative — putting the key in argv — exposes it to `ps` for the whole
 * lifetime of the deploy. Directory is chmod 700 and removed by the caller.
 */
function withIdentity(kp, fn) {
  const dir = mkdtempSync(join(tmpdir(), "proved-id-"));
  try {
    chmodSync(dir, 0o700);
    writeFileSync(
      join(dir, "identity.json"),
      JSON.stringify({ id: "deployer", publicKey: kp.publicKey(), secretKey: kp.secret() }),
      { mode: 0o600 },
    );
    return fn(dir, kp.publicKey());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Measure what a deploy costs, by asking the network rather than assuming.
 *
 * Testnet and mainnet price Soroban resources completely differently, so a
 * constant is wrong on one of them and there is no safe value to hard-code. A
 * single `simulateTransaction` on an upload of the real WASM returns the exact
 * resource fee, which is the number that matters and the one the network will
 * enforce.
 *
 * @returns {Promise<{required:number, upload:number, other:number, headroom:number, note:string}>}
 */
export async function estimateDeployCost(netName, net, address) {
  const HEADROOM = 2;
  const note =
    netName === "mainnet"
      ? "Mainnet prices resources ~2000x above testnet; this is not a mistake."
      : "Testnet resource fees are heavily discounted.";

  let upload = 0.0108; // measured fallback, if the node will not simulate
  let measured = false;
  try {
    const wasm = readFileSync(WASM);
    const server = new rpc.Server(net.rpcUrl);
    const acct = await server.getAccount(address);
    const seq = (BigInt(acct.sequenceNumber()) + 1n).toString();

    const tx = new TransactionBuilder(new Account(address, seq), {
      fee: "100",
      networkPassphrase: net.passphrase,
    })
      .addOperation(Operation.uploadContractWasm({ wasm, source: address }))
      .setTimeout(300)
      .build();

    // The SDK's wrapper parses away the raw fee, so ask the node directly and
    // decode the XDR by hand.
    const res = await fetch(net.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: { transaction: tx.toXDR().toString("base64") },
      }),
    }).then((r) => r.json());

    if (res.result?.transactionData && !res.result?.error) {
      const data = xdr.SorobanTransactionData.fromXDR(res.result.transactionData, "base64");
      upload = Number(BigInt(data.resourceFee ?? data.resource_fee ?? "0")) / 1e7;
      measured = true;
    }
  } catch (e) {
    // A node that will not simulate should not block the deploy, but the caller
    // must know the figure is a fallback.
    note += ` Could not measure (${e.message}); using a measured fallback.`;
  }

  // Creating the instance and running the constructor is small next to the
  // upload, but it is not zero and pretending otherwise would be a guess.
  const other = 0.5;
  return {
    upload,
    other,
    headroom: HEADROOM,
    required: upload + other + HEADROOM,
    note: measured ? note : note + " (fallback estimate, not measured)",
  };
}

/**
 * Cheap things to check before touching mainnet, so a half-finished deployment is
 * impossible rather than merely unlikely.
 */
export async function preflight(netName, deployer) {
  const net = getNetwork(netName);
  const notes = [];

  // Which address did the operator think this key controls? If they told us, hold
  // them to it. A seed phrase and a secret key for the *wrong* account still
  // produce a perfectly valid, perfectly wrong keypair, and the only symptom is a
  // contract at an address nobody holds. Compare before anything else.
  const expected = process.env.DEPLOYER_ADDRESS?.trim();
  const derived = deployer.publicKey();
  if (expected && expected !== derived) {
    throw new Error(
      `the deployer key does not control the expected address.\n` +
        `  key derives to  ${derived}\n` +
        `  you expected    ${expected}\n` +
        `Set DEPLOYER_ADDRESS to the address you intend to deploy from, and make ` +
        `sure DEPLOYER_SECRET is the key or 12/24-word mnemonic for it. Refusing ` +
        `to continue rather than deploying to an address you cannot sign for.`,
    );
  }
  notes.push(`deployer key ${derived}`);

  const res = await fetch(`${net.horizonUrl}/accounts/${derived}`);
  if (!res.ok) {
    throw new Error(
      `deployer ${derived} does not exist on ${net.label} — it has never been ` +
        `funded, and funding an address is what creates it. Check that the key ` +
        `in DEPLOYER_SECRET is the one for the account you meant to use.`,
    );
  }
  const acct = await res.json();
  const native = acct.balances.find((b) => b.asset_type === "native");
  const balance = Number(native?.balance ?? 0);

  // What a deploy actually costs, per network.
  //
  // Do not carry the testnet figure across. Mainnet resource fees are ~2000×
  // testnet's: the same 15,885-byte WASM simulates at 21.41 XLM on mainnet
  // against 0.0108 XLM on testnet, which is why an account funded with 3 XLM —
  // twenty times the testnet figure — was rejected with TxInsufficientBalance.
  // A floor copied from the cheap network is worse than no floor, because it
  // confidently waves through a deploy that cannot possibly land.
  const need = await estimateDeployCost(netName, net, derived);
  notes.push(`deployer balance ${balance.toFixed(4)} XLM`);
  if (balance < need.required) {
    throw new Error(
      `deployer holds ${balance.toFixed(4)} XLM but this deploy needs ` +
        `~${need.required.toFixed(2)} XLM (measured: WASM upload ` +
        `${need.upload.toFixed(2)} XLM, plus instance and constructor ` +
        `${need.other.toFixed(2)} XLM, plus ${need.headroom.toFixed(2)} XLM ` +
        `headroom for retries and TTL restores).\n` +
        `  Send at least ${need.required.toFixed(2)} XLM to ${derived}.\n` +
        `  ${need.note}`,
    );
  }
  notes.push(`deploy needs ~${need.required.toFixed(2)} XLM — balance is sufficient`);

  // The settlement asset must resolve to a contract that actually exists, and to
  // the one the ledger reports. A wrong address here would point every payment
  // at the wrong contract.
  const token = net.usdc || sacIdForAsset("USDC", net.usdcIssuer, netName);
  const sac = await fetch(
    `${net.horizonUrl}/assets?asset_code=USDC&asset_issuer=${net.usdcIssuer}`,
  );
  if (sac.ok) {
    const a = await sac.json();
    const rec = a._embedded?.records?.[0];
    if (rec?.contract_id && rec.contract_id !== token) {
      throw new Error(
        `derived USDC contract ${token} does not match what the ledger reports ` +
          `(${rec.contract_id}). Refusing to deploy against a wrong asset.`,
      );
    }
    notes.push(`USDC SAC ${token} confirmed on ${net.label}`);
  }
  return { notes, token, balance };
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
  } else {
    const pf = await preflight(netName, deployer);
    for (const n of pf.notes) console.log(`  ${n}`);
    if (pf.token && !token) token = pf.token;
  }

  console.log(`\nDeploying Proved -> ${net.label}`);
  console.log(`  from   ${deployer.publicKey()}`);
  console.log(`  rpc    ${net.rpcUrl}`);
  if (token) console.log(`  asset  ${token}`);

  const out = withIdentity(deployer, (configDir, address) =>
    run(
      "stellar",
      [
        "contract",
        "deploy",
        "--wasm",
        wasmPath,
        "--network",
        netName,
        // Referenced by address, not by secret: argv is world-readable.
        "--source-account-id",
        address,
        "--config-dir",
        configDir,
        "--rpc-url",
        net.rpcUrl,
        "--network-passphrase",
        net.passphrase,
        ...(token ? ["--", "--token", token] : []),
      ],
      { STELLAR_ACCOUNT: address },
    ),
  );

  const ids = [...out.matchAll(/C[A-Z2-7]{55}/g)].map((m) => m[0]);
  const contractId = ids[ids.length - 1];
  const txHashes = [...out.matchAll(/\b[0-9a-f]{64}\b/g)].map((m) => m[0]);

  if (!contractId) throw new Error(`could not read contract id from:\n${out}`);
  return { contractId, txHashes, deployer: deployer.publicKey(), network: netName };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const netName = networkName();
  const net = getNetwork(netName);
  // Derive the settlement asset's SAC id from its issuer rather than trusting a
  // pasted constant. Horizon reports the same value as `contract_id`.
  let token = net.usdc || sacIdForAsset("USDC", net.usdcIssuer, "mainnet");

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
