#![no_std]
//! Proved — paid on proof.
//!
//! A symmetric settlement primitive for cross-border service work.
//!
//! The incumbent model needs a human review window because it cannot prove that
//! work was delivered acceptably. That window is then monetised twice: once in
//! delay, and once in a flat arbitration fee that makes small disputes
//! economically impossible to contest. On Stellar a dispute can instead cost a
//! fraction of a percent of the amount, so *every* dispute becomes contestable.
//!
//! The invariant this contract exists to enforce:
//!
//! > **After a verified release there is no path back to the client.**
//!
//! It is enforced in exactly one place — [`Proved::challenge`] refuses any job
//! that is not `Open`. Read `challenge` and `submit`; that is the whole
//! security argument, and it is twenty lines.
//!
//! Adjudication is fully on-chain: the contract compares the artifact the
//! freelancer submitted against the commitment the client signed *at funding
//! time*. No oracle, no panel, no model, no caller-supplied verdict.
//!
//! # Storage
//!
//! Jobs and reputation live in **persistent** storage keyed by id, not in
//! instance storage. A single contract-data entry is capped at 64 KiB, so
//! instance storage would cap this contract at roughly 150 jobs and then make
//! it permanently unusable — with funds locked inside it. Instance storage holds
//! only the immutable settlement asset.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, Address,
    BytesN, Env, Symbol,
};

/// Fee for the challenge path, in basis points. 15 bps = 0.15%.
const CHALLENGE_BPS: i128 = 15;
/// Smallest challenge bond actually collected, as a multiple of one whole unit
/// of the settlement asset. Below this, challenging is cheaper than the gas it
/// burns, so it does not deter griefing; above it, the bond does not mean
/// anything to the person posting it.
///
/// Expressed in whole units rather than stroops because classic Stellar assets
/// are 7-decimal while USDC is 6, and this contract must be correct for
/// whichever asset it is pointed at. Resolved against the token's own
/// `decimals()` in the constructor: 1.00 for USDC and for PUSD alike.
const MIN_CHALLENGE_UNITS: i128 = 1;
/// Freelancer stake on an account with no delivery history, in basis points.
const STAKE_BASE_BPS: i128 = 300;
/// Half-life constant for the reputation curve: `STAKE_HALFLIFE` completed
/// deliveries halves the required stake.
const STAKE_HALFLIFE: i128 = 20;
/// Stakes below this are not collected, in whole units of the settlement asset.
/// We do not lock amounts too small to mean anything, because a symbolic stake
/// deters nobody. 5.00.
const MIN_STAKE_UNITS: i128 = 5;
/// Grace period past `deliver_by` before an undelivered job can be swept.
/// ~30s. Deliberately brutal: the point is that there is no review window to
/// sit in.
const GRACE_SECS: u64 = 30;
/// TTL policy. Every write extends well past any realistic settlement window.
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 500_000; // ~29 days at a 5s close

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyUsed = 1,
    NotFound = 2,
    WrongState = 3,
    WindowClosed = 4,
    AlreadyAdjudicated = 5,
    TooLate = 6,
}

/// Job lifecycle. `Released` and `Settled` are terminal — and that is the
/// entire point of the product.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum State {
    /// Funded, awaiting delivery.
    Open,
    /// Terminal. Funds moved to the freelancer and are not recoverable.
    Released,
    /// The client has posted a bond to contest delivery.
    Challenged,
    /// Terminal. A challenge was resolved.
    Settled,
}

/// A job, stored under its id. Job ids are single-use, which is what makes
/// fulfillment non-replayable.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Job {
    pub freelancer: Address,
    pub client: Address,
    pub amount: i128,
    pub condition_hash: BytesN<32>,
    pub artifact_hash: Option<BytesN<32>>,
    pub reason_hash: Option<BytesN<32>>,
    pub stake: i128,
    pub challenge_bond: i128,
    pub deliver_by: u64,
    pub opened_at: u64,
    pub state: State,
}

#[contractevent(data_format = "vec")]
pub struct JobOpened {
    #[topic]
    pub job: BytesN<32>,
    pub freelancer: Address,
    pub client: Address,
    pub amount: i128,
    pub stake: i128,
}

#[contractevent(data_format = "vec")]
pub struct FundsReleased {
    #[topic]
    pub job: BytesN<32>,
    pub freelancer: Address,
    /// Always true. There is no code path that sets this false.
    pub irreversible: bool,
}

#[contractevent(data_format = "vec")]
pub struct DeliveryChallenged {
    #[topic]
    pub job: BytesN<32>,
    pub challenger: Address,
    pub bond: i128,
}

/// `outcome`: 0 = freelancer performed, 1 = freelancer did not perform,
/// 2 = nothing ever delivered. In every case the money has already moved by the
/// time this is emitted.
#[contractevent(data_format = "vec")]
pub struct ChallengeResolved {
    #[topic]
    pub job: BytesN<32>,
    pub outcome: u32,
    pub bond: i128,
}

#[contract]
pub struct Proved;

#[contractimpl]
impl Proved {
    /// The settlement asset. Immutable — this contract has no admin key and no
    /// upgrade path, deliberately. A settlement primitive that can be rewritten
    /// after funds are in it is not a settlement primitive.
    pub fn __constructor(env: &Env, token: Address) {
        // Read the asset's own precision once, so the floors below mean the same
        // number of dollars whatever the asset turns out to be.
        let decimals = soroban_sdk::token::TokenClient::new(env, &token)
            .decimals();
        let unit = pow10(decimals as u32) as i128;

        env.storage().instance().set(&symbol_short!("token"), &token);
        env.storage()
            .instance()
            .set(&symbol_short!("unit"), &unit);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Precision of the settlement asset, as reported by the token itself.
    pub fn decimals(env: &Env) -> u32 {
        soroban_sdk::token::TokenClient::new(env, &Self::token(env)).decimals()
    }

    pub fn token(env: &Env) -> Address {
        env.storage().instance().get(&symbol_short!("token")).unwrap()
    }

    /// Read a job. The entire read model for the app and the proof page — both
    /// render from this and nothing else.
    pub fn job(env: &Env, id: &BytesN<32>) -> Option<Job> {
        env.storage().persistent().get(id)
    }

    /// Lifecycle state as a number, so the invariant is checkable in one call.
    /// 0 = absent, 1 = open, 2 = released (terminal), 3 = challenged, 4 = settled.
    pub fn state(env: &Env, id: &BytesN<32>) -> u32 {
        match Self::job(env, id) {
            None => 0,
            Some(j) => match j.state {
                State::Open => 1,
                State::Released => 2,
                State::Challenged => 3,
                State::Settled => 4,
            },
        }
    }

    /// True once the money has moved and can never be moved back.
    pub fn is_final(env: &Env, id: &BytesN<32>) -> bool {
        matches!(Self::state(env, id), 2 | 4)
    }

    /// Delivery counters: `(completed, on_time, disputes_lost, disputes_won)`.
    /// Counters, not a score. The account carrying them belongs to the
    /// freelancer, which is the whole portability claim.
    pub fn reputation(env: &Env, who: &Address) -> (u64, u64, u64, u64) {
        let k = (symbol_short!("rep"), who.clone());
        let g = |f: Symbol| -> u64 {
            env.storage()
                .persistent()
                .get(&(k.clone(), f))
                .unwrap_or(0)
        };
        (
            g(symbol_short!("done")),
            g(symbol_short!("ontime")),
            g(symbol_short!("lost")),
            g(symbol_short!("won")),
        )
    }

    /// The stake this freelancer must lock to be funded upfront, in basis
    /// points. `completed = 0` -> 300. `20` -> 150. `200` -> 27.
    pub fn stake_bps(env: &Env, freelancer: &Address) -> i128 {
        let (completed, _, _, _) = Self::reputation(env, freelancer);
        STAKE_BASE_BPS * STAKE_HALFLIFE / (STAKE_HALFLIFE + completed as i128)
    }

    /// The stake, in strops, for a job of `amount`. Zero when it would fall
    /// below `MIN_STAKE`.
    pub fn stake_for(env: &Env, freelancer: &Address, amount: i128) -> i128 {
        let s = amount * Self::stake_bps(env, freelancer) / 10_000;
        if s < Self::unit(env) * MIN_STAKE_UNITS {
            0
        } else {
            s
        }
    }

    /// The minimum challenge bond for a job of `amount`, in strops. Proportional
    /// so it scales with the money at stake, floored so griefing costs more than
    /// the gas it burns. This is the number that used to be $337.50 flat.
    pub fn challenge_bond_for(env: &Env, amount: i128) -> i128 {
        let b = amount * CHALLENGE_BPS / 10_000;
        let floor = Self::unit(env) * MIN_CHALLENGE_UNITS;
        if b < floor {
            floor
        } else {
            b
        }
    }

    /// Fund a job. Both parties authorise in one transaction: the client puts up
    /// the full amount, the freelancer puts up whatever their reputation charges
    /// them. Neither can fund and walk away.
    pub fn open(
        env: &Env,
        id: &BytesN<32>,
        freelancer: &Address,
        client: &Address,
        amount: i128,
        condition_hash: &BytesN<32>,
        deliver_by: u64,
    ) {
        if amount <= 0 {
            env.panic_with_error(Error::WrongState);
        }
        if env.storage().persistent().has(id) {
            env.panic_with_error(Error::AlreadyUsed);
        }
        freelancer.require_auth();
        client.require_auth();

        let stake = Self::stake_for(env, freelancer, amount);
        let me = env.current_contract_address();

        Self::asset(env).transfer(client, &me, &amount);
        if stake > 0 {
            Self::asset(env).transfer(freelancer, &me, &stake);
        }

        let job = Job {
            freelancer: freelancer.clone(),
            client: client.clone(),
            amount,
            condition_hash: condition_hash.clone(),
            artifact_hash: None,
            reason_hash: None,
            stake,
            challenge_bond: 0,
            deliver_by,
            opened_at: env.ledger().timestamp(),
            state: State::Open,
        };
        Self::store(env, id, &job);

        JobOpened {
            job: id.clone(),
            freelancer: freelancer.clone(),
            client: client.clone(),
            amount,
            stake,
        }
        .publish(env);
    }

    /// Submit the delivered artifact.
    ///
    /// A matching artifact settles **inside this same transaction**, whether or
    /// not a challenge is already open: verification outranks adjudication,
    /// because there is nothing left to adjudicate. An unmatched artifact leaves
    /// the job open for the client to contest.
    ///
    /// There is no window in which approved work can be charged back — that
    /// absence is the product.
    pub fn submit(env: &Env, id: &BytesN<32>, artifact_hash: &BytesN<32>) {
        let mut job = Self::load(env, id);
        match job.state {
            // A challenge must not lock the worker out. If it could, a client
            // could challenge first and make correct delivery unwinnable.
            State::Open | State::Challenged => {}
            _ => env.panic_with_error(Error::AlreadyAdjudicated),
        }
        if env.ledger().timestamp() > job.deliver_by {
            env.panic_with_error(Error::TooLate);
        }
        job.freelancer.require_auth();

        job.artifact_hash = Some(artifact_hash.clone());
        if *artifact_hash == job.condition_hash {
            // Freelancer performed. Releases, and slashes any open bond.
            Self::settle(env, id, &mut job, true);
        } else {
            Self::store(env, id, &job);
        }
    }

    /// Contest delivery. The client posts a bond proportional to the amount.
    ///
    /// This is where the invariant lives: a job that has already released is not
    /// `Open`, so it cannot be challenged, and no other entry point moves funds
    /// out of a released job. Money that cleared a verified release is gone.
    pub fn challenge(env: &Env, id: &BytesN<32>, reason_hash: &BytesN<32>) {
        let mut job = Self::load(env, id);
        if job.state != State::Open {
            env.panic_with_error(Error::WrongState);
        }
        if env.ledger().timestamp() > job.deliver_by {
            env.panic_with_error(Error::WindowClosed);
        }
        job.client.require_auth();

        let bond = Self::challenge_bond_for(env, job.amount);
        Self::asset(env)
            .transfer(&job.client, &env.current_contract_address(), &bond);

        job.challenge_bond = bond;
        // Bound on-chain, so a challenge cannot be made on a pretext that is not
        // itself part of the permanent record.
        job.reason_hash = Some(reason_hash.clone());
        job.state = State::Challenged;
        Self::store(env, id, &job);

        DeliveryChallenged {
            job: id.clone(),
            challenger: job.client.clone(),
            bond,
        }
        .publish(env);
    }

    /// Resolve a challenge. Fully deterministic and fully on-chain: the contract
    /// compares the artifact the freelancer submitted against the commitment the
    /// client signed at funding. No external input decides this.
    pub fn confirm(env: &Env, id: &BytesN<32>) {
        let mut job = Self::load(env, id);
        if job.state != State::Challenged {
            env.panic_with_error(Error::WrongState);
        }
        let performed = job.artifact_hash == Some(job.condition_hash.clone());
        Self::settle(env, id, &mut job, performed);
    }

    /// Sweep a job where nothing was ever delivered. The client's money returns
    /// and the freelancer's stake is forfeited. Thirty seconds, not fourteen
    /// days.
    pub fn expire(env: &Env, id: &BytesN<32>) {
        let mut job = Self::load(env, id);
        if job.state != State::Open {
            env.panic_with_error(Error::WrongState);
        }
        if env.ledger().timestamp() <= job.deliver_by + GRACE_SECS {
            env.panic_with_error(Error::WindowClosed);
        }
        let total = job.amount + job.stake;
        Self::asset(env)
            .transfer(&env.current_contract_address(), &job.client, &total);
        Self::bump(env, &job.freelancer, symbol_short!("lost"), 1);
        job.state = State::Settled;
        Self::store(env, id, &job);
        ChallengeResolved {
            job: id.clone(),
            outcome: 2,
            bond: 0,
        }
        .publish(env);
    }

    /// Portable proof: `(freelancer, amount, delivered, state)`. Derived from
    /// chain state only — no server, no database, no account, no login. This is
    /// what the public proof page renders.
    pub fn attestation(env: &Env, id: &BytesN<32>) -> Option<(Address, i128, bool, u32)> {
        let j: Job = env.storage().persistent().get(id)?;
        let delivered = j.artifact_hash == Some(j.condition_hash.clone());
        let s = match j.state {
            State::Open => 1,
            State::Released => 2,
            State::Challenged => 3,
            State::Settled => 4,
        };
        Some((j.freelancer, j.amount, delivered, s))
    }

    // ---- internals -------------------------------------------------------

    /// One whole unit of the settlement asset, in its smallest denomination.
    fn unit(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("unit"))
            .unwrap_or(1_000_000)
    }

    fn asset(env: &Env) -> soroban_sdk::token::TokenClient<'_> {
        soroban_sdk::token::TokenClient::new(env, &Self::token(env))
    }

    fn load(env: &Env, id: &BytesN<32>) -> Job {
        env.storage()
            .persistent()
            .get(id)
            .unwrap_or_else(|| env.panic_with_error(Error::NotFound))
    }

    fn store(env: &Env, id: &BytesN<32>, job: &Job) {
        env.storage().persistent().set(id, job);
        env.storage()
            .persistent()
            .extend_ttl(id, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// The single place money moves out of the contract. Everything else routes
    /// through here, which is why the state machine is auditable by inspection.
    fn settle(env: &Env, id: &BytesN<32>, job: &mut Job, performed: bool) {
        let total = job.amount + job.stake + job.challenge_bond;
        let me = env.current_contract_address();

        if performed {
            // Freelancer performed. Their stake is theirs again and the client's
            // challenge bond is slashed to them.
            Self::asset(env).transfer(&me, &job.freelancer, &total);
            Self::bump(env, &job.freelancer, symbol_short!("done"), 1);
            Self::bump(env, &job.freelancer, symbol_short!("ontime"), 1);
            if job.challenge_bond > 0 {
                Self::bump(env, &job.freelancer, symbol_short!("won"), 1);
            }
            job.state = State::Released;
            Self::store(env, id, job);
            FundsReleased {
                job: id.clone(),
                freelancer: job.freelancer.clone(),
                irreversible: true,
            }
            .publish(env);
        } else {
            // Freelancer did not perform. Money and bond go back to the client.
            Self::asset(env).transfer(&me, &job.client, &total);
            Self::bump(env, &job.freelancer, symbol_short!("lost"), 1);
            job.state = State::Settled;
            Self::store(env, id, job);
        }

        ChallengeResolved {
            job: id.clone(),
            outcome: if performed { 0 } else { 1 },
            bond: job.challenge_bond,
        }
        .publish(env);
    }

    fn bump(env: &Env, who: &Address, field: Symbol, add: u64) {
        let base = (symbol_short!("rep"), who.clone());
        let key = (base, field.clone());
        let cur: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(cur + add));
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod common;
#[cfg(test)]
mod test;
#[cfg(test)]
mod adversarial;

/// 10^n, for turning an asset's declared precision into a strops-per-unit scale.
///
/// Left private on purpose: widening its visibility changes the compiled WASM,
/// and the deployed contract on mainnet is built from exactly this source. The
/// test harness wraps it rather than widening it, so `cargo test` and the shipped
/// binary can never be talking about different conversions.
fn pow10(n: u32) -> i128 {
    let mut out: i128 = 1;
    for _ in 0..n {
        out *= 10;
    }
    out
}
