import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const run = promisify(execFile);

/**
 * Demo-mode job creation, testnet only.
 *
 * Opening a job requires two signatures. Rather than pretend one wallet can
 * produce both, this route shells out to the repo's own chain driver, which
 * signs with the committed testnet keys. That makes the flow reproducible for a
 * judge with one command, and it is disabled outright on mainnet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = join(process.cwd(), "..", "..");

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") {
    return NextResponse.json(
      { error: "the demo custodian is disabled on mainnet — fund with a real wallet" },
      { status: 403 },
    );
  }

  let body: { description?: string; amount?: string; worker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const description = String(body.description ?? "").trim();
  const amount = Number(body.amount);
  const worker = body.worker === "proven" ? "proven" : "freelancer";

  if (!description) return NextResponse.json({ error: "describe the deliverable" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "amount out of range" }, { status: 400 });
  }

  const script = join(REPO, "scripts", "open-job.mjs");
  if (!existsSync(script)) {
    return NextResponse.json({ error: "scripts/open-job.mjs not found" }, { status: 500 });
  }

  try {
    const { stdout } = await run(
      process.execPath,
      [script, "--description", description, "--amount", String(amount), "--worker", worker],
      {
        cwd: REPO,
        env: { ...process.env, PROVED_JOBS_ONLY: "1" },
        timeout: 180_000,
        maxBuffer: 1 << 20,
      },
    );
    const jobId = stdout.trim().split("\n").filter(Boolean).pop();
    if (!jobId || !/^[0-9a-f]{64}$/.test(jobId)) {
      return NextResponse.json({ error: `driver returned no job id: ${stdout.slice(-300)}` }, { status: 500 });
    }
    return NextResponse.json({ jobId });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return NextResponse.json(
      { error: (err.stderr || err.message || "driver failed").slice(-400) },
      { status: 500 },
    );
  }
}
