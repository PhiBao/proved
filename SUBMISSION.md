# Submission — Find Your Way: Hackathon (General Track)

Deadline **2026-10-12 23:59 UTC**. Everything below is filled in and checked.

## Project name
`Proved`

## Repo (required, open source)
https://github.com/PhiBao/proved

## Video pitch (required, 3 min max)
https://github.com/PhiBao/proved/releases/download/v0.1/proved-pitch.mp4

2:51 · 1440×810 · H.264 · silent, burned-in captions. Regenerate with
`node scripts/pitch/shots.mjs && node scripts/pitch/build.mjs`.

## Other links (optional)
- Live app: https://proved-kiters-projects-e9e82f9c.vercel.app
- Contract: https://stellar.expert/explorer/testnet/contract/CBK3UQLFJEFXTNXZOXHTLXN2OCGS2POHHH2XHMCXFR7K2RIWVTMEPTMS
- Demo run: `pnpm run demo:testnet` — prints real hashes for both paths and the clawback attempt
- Read the contract's guarantees back: `pnpm run verify`

## Description (paste into the form)
The text below is written to the rubric: a named person in a named place with a
quantified pain, then an explicit "we are not X", then the mechanism, then why
Stellar. Passport's own template says *"Plain words beat jargon"* and *"Be
specific — this is usually a judging criterion."*

> Upwork charges **$337.50** to appeal a **$300** dispute. That is why most
> disputes never happen: the worker who cannot afford to appeal eats it. 71% of
> freelancers have failed to collect at least once, at an average loss of ~13% of
> their annual income. And the record is not theirs — one freelancer's eleven
> years and $446,922 of 100%-success work was erased by a single identity check.
>
> **We are not another escrow tool.** We are paid on proof: release is checked
> against a commitment the payer signed *when they paid*, so if the artifact
> matches, money moves in the same transaction — no 14-day review window, and
> therefore nothing to charge back, including the 30-day clawback that took
> $32,000 of completed, client-approved work. Contesting costs **0.15% of the job
> amount, floored at $1.00** — $1.80 on a $1,200 job — because on Stellar judging
> costs gas rather than a platform fee. A dispute you cannot afford to raise is a
> dispute you lose, so this changes who can contest at all.
>
> Both parties authorise funding in one transaction: the client funds, the worker
> locks what their delivery record charges (3% for an unknown account, halving
> with every verified delivery, zero under $5). Adjudication is the contract
> comparing the delivered artifact to the funding-time commitment — no oracle, no
> panel, no model. The invariant is enforced in one place and tested: **after a
> verified release there is no path back to the client.**
>
> Stellar-specific: minimum fee is **100 stroops ≈ $0.0000023**, so proportional
> adjudication is economically possible where a flat fee makes small disputes
> unappealable; deterministic ~5s finality makes settlement instant rather than
> pending; Soroban's atomic bilateral authorisation replaces an escrow agent's
> discretion entirely.
>
> Live on Stellar **testnet** (`CBK3UQLFJEFXTNXZOXHTLXN2OCGS2POHHH2XHMCXFR7K2RIWVTMEPTMS`),
> 20/20 contract tests, not audited, no real value. `pnpm run demo:testnet`
> reproduces every number with real transaction hashes.

## Before submitting
- [ ] Logged in on demo.stellarpassport.xyz and registered for the hackathon
- [ ] Description pasted into the form (above)
- [ ] Repo URL and video URL from this file
- [ ] Track set to **General Track**
- [ ] Email + T&C ticked
- [ ] Optional: mainnet deployment (needs a funded account, see below)
