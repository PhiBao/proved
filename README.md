# Proved

**Paid on proof.** Upwork charges **$337.50** to appeal a **$300** dispute. That single number is
why most disputes never happen — the worker who cannot afford to appeal simply eats it. Here,
contesting costs **0.15% of the job amount**, about **$1.80** on a $1,200 job, because on Stellar
judging costs gas, not a fee.

- **Live on mainnet,** settling in Circle's real USDC: [`CAUDYRMNZQ4ROOVNSEMJZQKHI5AYGUUAMRVWB27CTEKLOLEFWK3A3GNJ`](https://stellar.expert/explorer/mainnet/contract/CAUDYRMNZQ4ROOVNSEMJZQKHI5AYGUUAMRVWB27CTEKLOLEFWK3A3GNJ)
- **Contract (testnet),** with the full demo history: [`CBK3UQLFJEFXTNXZOXHTLXN2OCGS2POHHH2XHMCXFR7K2RIWVTMEPTMS`](https://stellar.expert/explorer/testnet/contract/CBK3UQLFJEFXTNXZOXHTLXN2OCGS2POHHH2XHMCXFR7K2RIWVTMEPTMS)
- **Wasm:** `9186424a90a0e933d45642f5f5d3e4f748763fbe9960562cc4c5541ebe337f31` (15,885 bytes, 15 exported functions) — the same bytes on both networks, rebuildable
- **Tests:** 34 `cargo test` — 23 correctness, 11 adversarial · 0 known dependency vulnerabilities · run in CI on every push
- **Stack:** Rust `soroban-sdk` 28 · Protocol 28 · Next.js 15

---

## Contents

- [The problem](#the-problem)
- [What we built](#what-we-built)
- [The invariant](#the-invariant)
- [Live, on-chain](#live-on-chain)
- [Why Stellar, with numbers](#why-stellar-with-numbers)
- [Business model](#business-model)
- [Architecture](#architecture)
- [Reproduce it](#reproduce-it)
- [Security review](#security-review)
- [Honest limitations](#honest-limitations)
- [Sources](#sources)

---

## The problem

Cross-border service work does not fail because transfers are slow. It fails because **disagreement
is expensive and reputation is rented.**

**The scale of non-payment** (freelancers and small agencies, paying a client they cannot sue):

| | |
|---|---|
| Freelancers who have failed to collect at least once | **71%** — average loss ≈ **$6,000** per incident, ≈ **13%** of annual income <sup>[1](https://www.freelancersunion.org/)</sup> |
| Paid late at least sometimes | **85%**; **21%** late or unpaid more than half the time <sup>[2](https://www.remote.com/state-of-freelance-work)</sup> |
| Waiting over 30 days for payment | **63%**; global average 39 days invoice→cash <sup>[3](https://www.jobbers.io/)</sup> |
| US small businesses owed money on unpaid invoices | **56%**, averaging **$17,500** <sup>[4](https://quickbooks.intuit.com/)</sup> |

**Why the industry built the problem it has.** Platform escrow protects the payer, not the worker.
On Upwork, escrow is administered by a party that *"can't (!) make a binding decision over the escrow
funds. They can only suggest a solution, which is usually to split the matter down the middle."*
Appeals cost **$337.50 per side regardless of dispute size** — so a $500 dispute is literally
unappealable, and *"I didn't pursue arbitration as I didn't have the money for it."*

Then there is the review window. A client can dispute a whole contract while funds are in escrow, or
for 30 days after a milestone releases — which is how **$32,000** of completed, client-approved work
was charged back.

And the thing that is hardest to replace: **the record is not yours.** A Top Rated Plus freelancer —
**eleven years, $446,922 earned, 100% job success, zero violations** — was banned after an
identity-verification review. Escrow reversed. Four clients, including a CEO, fought to keep him. He
had paid **$44,797** in fees over his career. Upwork's structural answer to this class of problem
was to buy a device-fingerprinting vendor in March 2026.

## What we built

A settlement primitive where **the condition for release is machine-checkable**, so there is no
window for a human to reverse it.

The 14-day review window exists for exactly one reason: nobody can prove the work was delivered
acceptably. So the industry substituted a human waiting period for verification, and then monetised
the resulting uncertainty twice — once in delay, and once in a flat fee that makes small disputes
unappealable.

**If delivery is verifiable, the review window is unnecessary, there is nothing to charge back, and
payment can be instant. And if the proof is contested, adjudication should cost gas.**

Concretely:

1. **The payer commits before paying.** They hash what "done" means and sign it in the same
   transaction that funds the job. That hash is on chain from the first second.
2. **The worker locks what their reputation charges.** 3% for an unknown account, halving with every
   verified delivery, reaching **zero** when the amount falls below $5. Both parties authorise one
   transaction; neither can fund and walk away.
3. **Delivery settles in one transaction.** If the artifact matches the commitment, money moves
   immediately. There is no approve button anywhere in this product — that absence *is* the product.
4. **Contesting is proportional.** 0.15%, floored at $1.00 so spamming disputes costs more than the
   gas it burns. Every dispute is contestable at any stakes.
5. **Adjudication is the contract.** `confirm()` compares the submitted artifact against the
   funding-time commitment itself. No oracle, no panel, no model, no caller-supplied verdict.
6. **The record belongs to the worker.** Counters live in their account, survive leaving any
   platform, and decide how much of their own money they must lock up next time.

## The invariant

> **After a verified release there is no path back to the client.**

It is enforced in exactly one place, and it is about twenty lines:

```rust
pub fn challenge(env: &Env, id: &BytesN<32>, reason_hash: &BytesN<32>) {
    let mut job = Self::load(env, id);
    if job.state != State::Open {
        env.panic_with_error(Error::WrongState);   // <-- released and settled are not Open
    }
    ...
```

No other entry point moves funds out of a released job. `submit()` only settles while `Open` or
`Challenged`; `confirm()` only settles while `Challenged`; `expire()` only sweeps while `Open`. There
is **no admin key and no upgrade path** — a settlement primitive that can be rewritten after funds
are in it is not a settlement primitive.

It is a test, not a claim:

```rust
#[test]
fn invariant_released_funds_cannot_be_reversed() {
    // ... deliver correctly, assert state == Released ...
    let fre_after = w.bal(&f);
    let cli_after = w.bal(&c);

    let _ = w.c.try_challenge(&id, &w.h(1));    // the $32,000 chargeback
    let _ = w.c.try_confirm(&id);
    let _ = w.c.try_expire(&id);
    let _ = w.c.try_submit(&id, &w.h(2));
    let _ = w.c.try_open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);

    assert_eq!(w.c.state(&id), 2);
    assert_eq!(w.bal(&f), fre_after);
    assert_eq!(w.bal(&c), cli_after);

    // Refused for the right reason, not incidentally.
    assert_eq!(fails(w.c.try_challenge(&id, &w.h(1))), Some(Error::WrongState.into()));
    assert_eq!(
        fails(w.c.try_submit(&id, &w.h(2))),
        Some(Error::AlreadyAdjudicated.into())
    );
    assert_eq!(fails(w.c.try_expire(&id)), Some(Error::WrongState.into()));
    assert_eq!(fails(w.c.try_confirm(&id)), Some(Error::WrongState.into()));
}
```

## Live, on-chain

**It runs on mainnet, against Circle's real USDC.**

| | |
|---|---|
| Contract | [`CAUDYRMNZQ4ROOVNSEMJZQKHI5AYGUUAMRVWB27CTEKLOLEFWK3A3GNJ`](https://stellar.expert/explorer/mainnet/contract/CAUDYRMNZQ4ROOVNSEMJZQKHI5AYGUUAMRVWB27CTEKLOLEFWK3A3GNJ) |
| Settles in | Circle USDC, SAC `CCW67TSZ…JMI75`, derived from the issuer and cross-checked against Horizon |
| WASM | `9186424a90a0e933d45642f5f5d3e4f748763fbe9960562cc4c5541ebe337f31` |
| Testnet | [`CBK3UQLFJEFXTNXZOXHTLXN2OCGS2POHHH2XHMCXFR7K2RIWVTMEPTMS`](https://stellar.expert/explorer/testnet/contract/CBK3UQLFJEFXTNXZOXHTLXN2OCGS2POHHH2XHMCXFR7K2RIWVTMEPTMS) |

`pnpm run verify -- --network mainnet` asks the deployed contract what a dispute costs, and gets
this back from mainnet contract code rather than from a constant in a document:

```
Proved on Mainnet
  settlement asset               CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
  asset precision                7 decimals
  on a 1,200.00 job              1200.00 USDC
  challenge bond                 1.80 USDC   (0.15%, floored at 1.00)
  Upwork flat fee                337.50 — for anyone, at any amount
  times cheaper                  188x
  challenge() on a released job  refuses — state != Open
  admin key                      none. no upgrade path.
```

Worth noting what that "7 decimals" is: Stellar's USDC carries **seven** decimals, not six. The
contract reads the precision from the asset at construction instead of assuming it, which is the only
reason the same `$5.00` and `$1.00` floors mean the same dollars on testnet's 7-decimal asset and
mainnet's USDC. Getting that wrong would have silently mispriced every job by an order of magnitude.

Every other claim above is a testnet transaction that landed. Reproduce the whole thing with one
command:

```bash
pnpm install && pnpm run demo:testnet    # funds accounts, mints the asset, runs both paths
pnpm run verify                          # re-reads the guarantees from the deployed contract
```

What it prints, from a live run against testnet:

```
The cost curve
  asset precision        7 decimals
  job amount             1,200.00 PUSD
  challenge bond         1.80 PUSD  (0.15%, floor 1.00)
  Upwork flat fee        337.50 — the same dispute, for anyone
  ratio                  188x cheaper to contest

Job A — verified delivery
  funded                 https://stellar.expert/explorer/testnet/tx/87590c41…
  delivered              artifact matched the funding-time commitment
  paid in                4.0s — no approve step, no review window
  state                  2 (2 = released, terminal)
  is_final               true
  freelancer record      completed=2 onTime=2 lost=1 won=0

Job B — a dispute, for $1.80
  delivered              artifact does NOT match the commitment
  state                  1 (1 = open — money still held)
  client challenged      posted 1.80 PUSD in 4.5s
  adjudicated            in 8.9s total, by contract, no human
  state                  4 (4 = settled, client refunded)

Can job A be clawed back?
  client challenges      refused — Error(Contract, #3)
  freelancer re-submits  refused — Error(Contract, #5)
  anyone tries to expire  refused — Error(Contract, #3)
  state still            2 (2 = released, irreversible)

Portable proof — from chain state, no login
  freelancer  GBQQJ7U74QNPWMYEPP25KKB3TAHQ2XWGBKPHK4VVHIVROJ3ZCFSHORMG
  amount      1200.00
  delivered   true
```

A `FundsReleased` event is emitted with `irreversible: true`, and there is no code path that sets
it false. The whole loop is visible in [one job on a block explorer](https://stellar.expert/explorer/testnet/tx/3b74d07c10a1120e4c28ab59ac8ec0e7169407084800b67c4ce9929b4f410382).

## Why Stellar, with numbers

This is not "we added a wallet." Remove the chain and the product collapses to Upwork.

| | |
|---|---|
| Network minimum fee | **100 stroops = 0.00001 XLM**, about **$0.0000023** |
| A full contract deployment, testnet | **0.0108 XLM**, measured |
| The same deployment on mainnet | **21.41 XLM**, measured — mainnet prices resources ~2000× higher |
| Dispute resolution | the **same** order of magnitude as a transfer |
| Settlement finality | deterministic, ~5s blocks |

The claim that matters is not "cheap." It is that **the marginal cost of judgment is computation, so
a dispute costs a percentage of the amount instead of a flat fee decided by a platform.** A platform
that charges a flat $337.50 *earns from disputes persisting*; it cannot price adjudication
proportionally without repricing its own business. That is a structural difference, not a discount.

Two implementation notes that came out of building against it:

- **A single contract-data entry is capped at 64 KiB.** Jobs and reputation therefore live in
  *persistent* storage keyed by id, not instance storage. Instance storage would have capped this
  contract at roughly 150 jobs and then made it permanently unusable — with funds locked inside it.
  A regression test that settles 214 jobs caught this.
- **Classic Stellar assets are 7-decimal; USDC is 6-decimal.** The bond floors are resolved against
  the token's own `decimals()` at construction, so $1.00 means $1.00 whichever asset the contract is
  pointed at. A hard-coded `1_000_000` would have been silently 10× wrong on a classic asset.

## Business model

We take a small settlement fee from the **payer**, for guaranteed non-reversible delivery. The payer
is buying certainty, and the marginal cost of that certainty is fractions of a cent, so it prices
correctly at a few tenths of a percent. We earn only when money actually moves.

**We deliberately do not take a cut of the worker's money, because that recreates the incumbent's
conflict of interest — which is the cause of the flat arbitration fee.** That is the sharpest thing
we can say about the business model: *Upwork profits from disputes persisting; we profit from money
moving.*

Scaling is a compounding network good. Every settlement adds a verifiable edge between two parties.
More counterparties → a denser trust graph → lower stakes for everyone → more settlements that clear
instantly → a denser graph. And unlike Upwork's, it is not a walled garden, so it captures value
across the whole ecosystem instead of being destroyed when a user leaves.

The larger business here is *advancing against verified delivery history* — letting a worker with 200
clean jobs invoice weekly instead of waiting 39 days. That is a follow-on, not this MVP.

## Architecture

```
contracts/proved/src/lib.rs        Rust, soroban-sdk 28, wasm32v1-none, 15 exported fns
  open()        both parties authorise atomically; client funds, worker posts their stake
  submit()      a matching artifact releases in the same transaction
  challenge()   THE INVARIANT — refuses any job that is not Open
  confirm()     adjudication compares artifact vs. funding-time commitment, on chain
  expire()      undelivered jobs sweep after 30s, not fourteen days
  attestation() portable proof, derived from chain state alone
  reputation()  four counters, owned by the worker's account
src/test.rs                        23 correctness tests; the invariant is one of them
src/adversarial.rs                 11 attacks, named as attacks

apps/web/                          Next.js 15 · React 19 · Tailwind
  /                the pitch and the cost curve
  /j/[id]          the job, role-aware. No approve button, on purpose
  /proof/[id]      renders from chain state. No account, no server database
  /api/demo/open   testnet demo mode: two signatures, so it uses the committed keys

scripts/
  keys.mjs       deterministic testnet identities, committed deliberately
  deploy.mjs     mainnet preflight, USDC SAC derived and cross-checked
  demo.mjs       both paths plus the clawback attack, against a live network
  walk.mjs       one job, start to paid
  verify.mjs     read the deployed contract and print its guarantees and events
```

## Reproduce it

```bash
git clone https://github.com/PhiBao/proved && cd proved
pnpm install
pnpm run build:contract      # needs stellar-cli 28.1+ and the wasm32v1-none target
pnpm run test:contract       # 34 tests: 23 correctness, 11 adversarial
pnpm run audit               # dependency advisories + adversarial coverage + deployed-hash check
pnpm run deploy:testnet      # prints a contract id, recorded in deployments.json
pnpm run sync-env            # writes apps/web/.env.local from deployments.json
pnpm run demo:testnet        # the full demo, live, with real transaction hashes
pnpm run verify              # read the contract's guarantees back off the chain
pnpm run dev                 # the web app on :3000
```

**Mainnet.** Set `STELLAR_RPC_MAINNET` (Soroban RPC is not free-public; QuickNode, Alchemy, Ankr,
Validation Cloud and Chainstack all work), export `DEPLOYER_SECRET` for an account holding about **24 XLM**, then `pnpm run deploy:mainnet`.

That figure is not a guess. Mainnet prices Soroban resources about **2000×** above testnet: the same
15,885-byte WASM costs **21.41 XLM** to upload there against **0.0108 XLM** on testnet. A preflight
simulates an upload of the real WASM against the target network and reads the resource fee the node
itself quotes, then refuses before touching the network if the balance is short — because a floor
copied from the cheap network is worse than no floor, as we found the hard way.

The settlement asset is Circle's USDC, derived from its issuer and cross-checked against Horizon's
reported `contract_id` — never hard-coded, because a wrong constant would point every payment at the
wrong contract and fail silently.

**Testnet keys are committed on purpose.** They are derived from public hard-coded seeds, hold no
value, and let a judge reproduce every number above without asking anyone for a secret. Mainnet keys
are only ever read from the environment.

## Security review

`pnpm run audit` — the whole thing, re-runnable, and run in CI on every push:

```
1. Dependency advisories
   ✓ 0 known vulnerabilities in 418 dependencies
   ✓ no unmaintained crates
2. What the contract can actually do
   ✓ no admin, owner, upgrade or migration entry point in the source
   ✓ 4 require_auth() call sites — parties cannot act alone
3. Invariants
   ✓ 34 passed
4. Adversarial coverage
   ✓ every public function appears in the adversarial surface
   ✓ tested WASM sha256 9186424a… matches the mainnet deployment
```

The one unmaintained crate in the tree, `paste`, is a proc-macro reached through `ark-ff`; its
symbols are absent from the shipped WASM, so it contributes no code. Stated rather than hidden.

`src/adversarial.rs` holds eleven attacks, each named as the attack rather than the defence, so
coverage reads against the contract's public surface: every route out of both terminal states, sweep
abuse, adjudication single-shot, challenge single-shot, replay, degenerate amounts, unknown-id reads,
and the bond's bounds. Two of the tests exist to fail when the coverage itself rots — one checks the
surface list names real functions, the other checks every `pub fn` is in it, so a function added
later without an attack breaks the build.

The CI job that matters rebuilds the WASM from a clean checkout and fails if it differs from the
hash deployed on mainnet. "The tests pass" and "the deployed contract is the tested contract" stop
being two claims a reader has to take on faith.

## Honest limitations

- **Not audited by a human.** What we have is an automated review and 34 tests, run in CI, plus
  coverage that fails when it lapses. That is evidence, not assurance.
- **The `$1.00` floor means small jobs cannot be disputed.** Below about **$10** the floor is a large
  enough share of the job that contesting stops being worth it — at $1 the bond is the entire job
  amount. It exists so a challenge cannot cost less than the gas it burns, and it is the price of
  that. The test suite pins the boundary rather than leaving a judge to discover it. **Proved is for
  jobs above ~$10, not for micropayments**, which is a narrower claim than we would like.
- **We prove identity, not quality.** The contract sees a hash, never the content. It proves the
  delivered artifact is byte-for-byte what was contracted — which is why the commitment is pinned
  before funding — and it cannot tell a good deliverable from a bad one. That is exactly why the
  dispute path exists rather than being a failure of it.
- **A first-time freelancer locks 3% of the job.** `$36.00` on a `$1,200` job. The stake is locked,
  not spent — a verified release returns it — but it is real friction for someone with no history,
  and it is the honest cost of making them fundable at all.
- **The testnet settlement asset is our own**, a 7-decimal classic asset, so the demo never depends
  on a third-party faucet. The dollar figures are identical to what real USDC produces because the
  contract reads the asset's own precision. Mainnet settles in Circle's USDC.
- **Job creation in the browser needs two signatures**, which one wallet cannot produce, so the web
  app's demo mode shells out to the committed testnet keys. It is refused outright on mainnet.
- **Not a payments company.** We compete on the cost of disagreement, not on transfer fees. If
  someone makes transfers cheaper, that does not touch us; if someone makes disputes cheap, it does.
- **The `$337.50` comparison is to Upwork's *arbitration* fee**, quoted from freelancer reports and
  community threads, not from a published tariff. It is the number workers describe, and it is the
  right number to beat, but we have not audited it against a contract.

## Sources

<sub>[1] Freelancers Union survey (n>5,000) · [2] Remote, State of Freelance Work 2025 · [3]
Jobbers.io, 22,847 transactions across 62 countries · [4] QuickBooks 2025 · Upwork arbitration fee,
review window, chargeback and account-ban behaviour: r/Upwork threads 2025–2026, cited verbatim
above. Stellar fee and protocol data: `developers.stellar.org`, `horizon-testnet.stellar.org`,
`soroban-testnet.stellar.org`.</sub>

MIT.
