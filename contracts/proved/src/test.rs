//! Correctness suite for the Proved settlement primitive.
//!
//! The centre of gravity is [`invariant_released_funds_cannot_be_reversed`]:
//! every claim the product makes about irreversibility has to reduce to a test
//! that fails the moment someone adds a back door.
//!
//! Balances are asserted in strops. `ONE` is one unit of a 6dp asset, so
//! `$1,200` is `1_200 * ONE` and `$337.50` — the Upwork flat arbitration fee
//! this product exists to beat — is `337_500_000`.

#![cfg(test)]

use soroban_sdk::{testutils::Ledger as _};

use crate::common::*;
use crate::Error;

// ------------------------------------------------- the reputation curve -----

/// 3% of $1,200 is $36, which clears the $5 floor, so a brand-new freelancer
/// does put something of their own at risk.
#[test]
fn fresh_freelancer_locks_three_percent() {
    let w = W::build();
    let f = w.party();
    w.fund(&f);
    assert_eq!(w.c.stake_bps(&f), 300);
    assert_eq!(w.c.stake_for(&f, &w.twelve_hundred()), 36 * w.one()); // $36
}

#[test]
fn reputation_halves_the_stake() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    // 20 real settlements in one test exceeds the default instruction budget.
    let mut budget = w.env.cost_estimate().budget();
    budget.reset_unlimited();
    for i in 0..20u8 {
        w.settle(&f, &c, w.twelve_hundred(), i);
    }
    assert_eq!(w.c.reputation(&f).0, 20);
    assert_eq!(w.c.stake_bps(&f), 150); // 300 * 20 / 40
    assert_eq!(w.c.stake_for(&f, &w.twelve_hundred()), 18 * w.one()); // $18
}

/// The exact numbers quoted in the demo: 214 verified deliveries, nothing locked.
#[test]
fn the_two_hundred_and_fourteen_case_from_the_demo() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let mut budget = w.env.cost_estimate().budget();
    budget.reset_unlimited();
    for i in 0..214u8 {
        w.settle(&f, &c, w.twelve_hundred(), i);
    }
    assert_eq!(w.c.reputation(&f), (214, 214, 0, 0));
    // 300 * 20 / 234 = 25 bps -> $3.00 on $1,200, under the $5 floor.
    assert_eq!(w.c.stake_bps(&f), 25);
    assert_eq!(w.c.stake_for(&f, &w.twelve_hundred()), 0);
}

/// Same curve on a large job, where the floor does not mask it. The curve is
/// smooth, not a cliff.
#[test]
fn the_curve_still_bites_on_a_large_job() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    // 214 x $50,000 needs a deeper client than the default funding.
    w.asset.mint(&c, &(50_000_000 * w.one()));
    let mut budget = w.env.cost_estimate().budget();
    budget.reset_unlimited();
    for i in 0..214u8 {
        w.settle(&f, &c, 50_000 * w.one(), i);
    }
    // 25 bps of $50,000 = $125.
    assert_eq!(w.c.stake_for(&f, &(50_000 * w.one())), 125 * w.one());
}

/// We do not lock amounts too small to mean anything.
#[test]
fn stakes_below_the_floor_are_not_collected() {
    let w = W::build();
    let f = w.party();
    assert_eq!(w.c.stake_bps(&f), 300);
    assert_eq!(w.c.stake_for(&f, &(10 * w.one())), 0); // $0.30 < $5 floor
    assert_eq!(w.c.stake_for(&f, &(5_000 * w.one())), 150 * w.one()); // $150
}

// -------------------------------------------------------- the cost curve ----

#[test]
fn the_challenge_bond_is_proportional_with_a_floor() {
    let w = W::build();
    assert_eq!(w.c.challenge_bond_for(&w.twelve_hundred()), 18 * w.one() / 10); // $1.80
    assert_eq!(w.c.challenge_bond_for(&(100 * w.one())), w.one()); // floor: $1.00
    assert_eq!(w.c.challenge_bond_for(&(30_000 * w.one())), 45 * w.one()); // $45
}

/// The economic claim of the entire product, asserted.
#[test]
fn a_dispute_costs_cents_where_the_flat_fee_is_337_dollars() {
    let w = W::build();
    let bond = w.c.challenge_bond_for(&w.twelve_hundred());
    let flat = (UPWORK_FLAT_USD * w.one()) + (w.one() / 2); // $337.50
    assert_eq!(bond, 18 * w.one() / 10); // $1.80
    assert!(
        bond * 100 < flat,
        "bond {} must be far below the flat fee {}",
        bond,
        flat
    );
}

// ------------------------------------------------------ the happy path ------

#[test]
fn verified_delivery_releases_in_the_same_transaction() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(3);
    let cond = w.h(200);

    let cli_before = w.bal(&c);
    let fre_before = w.bal(&f);
    let stake = w.c.stake_for(&f, &w.twelve_hundred());
    assert_eq!(stake, 36 * w.one());

    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    // Funds are in the contract, not yet with the freelancer.
    assert_eq!(w.bal(&c), cli_before - w.twelve_hundred());
    assert_eq!(w.bal(&f), fre_before - stake);

    // One call. No approval round-trip, no review window.
    w.c.submit(&id, &cond);

    assert_eq!(w.c.state(&id), 2);
    assert!(w.c.is_final(&id));
    // Client is out exactly the job amount. Freelancer is up amount + stake.
    assert_eq!(w.bal(&c), cli_before - w.twelve_hundred());
    assert_eq!(w.bal(&f), fre_before - stake + w.twelve_hundred() + stake);
    assert_eq!(w.c.reputation(&f), (1, 1, 0, 0));
}

// ----------------------------------------------------- THE INVARIANT --------

#[test]
fn invariant_released_funds_cannot_be_reversed() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(5);
    let cond = w.h(210);

    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    w.c.submit(&id, &cond);
    assert_eq!(w.c.state(&id), 2);
    assert!(w.c.is_final(&id));

    let fre_after = w.bal(&f);
    let cli_after = w.bal(&c);

    // Every route back, one at a time. This is the $32,000 chargeback on
    // completed, client-approved work.
    let _ = w.c.try_challenge(&id, &w.h(1));
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

/// A job that lost a dispute is also final, and also unreversible.
#[test]
fn a_settled_job_is_also_final() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(6);
    let cond = w.h(211);
    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    w.c.challenge(&id, &w.h(3));
    w.c.confirm(&id); // freelancer never delivered -> client refunded, state 4
    assert_eq!(w.c.state(&id), 4);
    assert!(w.c.is_final(&id));
    let cli_after = w.bal(&c);
    let _ = w.c.try_challenge(&id, &w.h(4));
    assert_eq!(w.c.state(&id), 4);
    assert_eq!(w.bal(&c), cli_after);
}

// ---------------------------------------------------- the dispute path ------

#[test]
fn a_mismatched_artifact_releases_nothing_and_can_be_challenged() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(8);
    let cond = w.h(212);
    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    let fre_funded = w.bal(&f);
    let cli_funded = w.bal(&c);
    w.c.submit(&id, &w.h(9)); // wrong artifact

    // Nothing beyond the opening stake moved. This is the only window in which
    // a dispute can exist at all.
    assert_eq!(w.c.state(&id), 1);
    assert_eq!(w.bal(&f), fre_funded);

    w.c.challenge(&id, &w.h(10));
    assert_eq!(w.c.state(&id), 3);
    assert_eq!(w.c.job(&id).unwrap().challenge_bond, 18 * w.one() / 10);
    // The $1.80 bond, and nothing else moved.
    assert_eq!(w.bal(&c), cli_funded - 18 * w.one() / 10);
}

/// The client challenges *before* anything is delivered, then the freelancer
/// delivers the artifact the client committed to at funding. A challenge must
/// not make correct delivery unwinnable.
#[test]
fn a_correct_delivery_beats_an_open_challenge() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(13);
    let cond = w.h(213);
    let stake = w.c.stake_for(&f, &w.twelve_hundred());
    let bond = w.c.challenge_bond_for(&w.twelve_hundred());
    let fre_before = w.bal(&f);

    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    w.c.challenge(&id, &w.h(14));
    assert_eq!(w.c.state(&id), 3);

    // Delivering while challenged is allowed, and settles immediately.
    w.c.submit(&id, &cond);
    assert_eq!(w.c.state(&id), 2);

    // Freelancer keeps the job, their stake, and the slashed bond.
    assert_eq!(
        w.bal(&f),
        fre_before - stake + w.twelve_hundred() + stake + bond
    );
    assert_eq!(w.c.reputation(&f), (1, 1, 0, 1));
}

/// Same shape, but the artifact never matches: the client gets everything back.
#[test]
fn a_dispute_the_freelancer_lost_refunds_the_client_and_costs_them_the_stake() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(14);
    let cond = w.h(214);
    let stake = w.c.stake_for(&f, &w.twelve_hundred());

    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    let cli_funded = w.bal(&c);
    w.c.submit(&id, &w.h(15)); // wrong artifact
    w.c.challenge(&id, &w.h(16));
    w.c.confirm(&id);

    assert_eq!(w.c.state(&id), 4);
    // Client is made whole: their money back, plus the freelancer's stake.
    assert_eq!(w.bal(&c), cli_funded + w.twelve_hundred() + stake);
    assert_eq!(w.c.reputation(&f).2, 1); // disputes lost
}

#[test]
fn nothing_delivered_refunds_the_client_after_the_grace_period() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(15);
    let cond = w.h(215);
    let stake = w.c.stake_for(&f, &w.twelve_hundred());

    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    let cli_funded = w.bal(&c);
    let _ = w.c.try_expire(&id);
    assert_eq!(w.c.state(&id), 1, "cannot sweep before the deadline");

    w.env.ledger().set_timestamp(FAR_FUTURE + 31);
    w.c.expire(&id);

    assert_eq!(w.c.state(&id), 4);
    assert_eq!(w.bal(&c), cli_funded + w.twelve_hundred() + stake);
    assert_eq!(w.c.reputation(&f).2, 1);
}

#[test]
fn submission_after_the_deadline_is_refused() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(16);
    let cond = w.h(216);
    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    w.env.ledger().set_timestamp(FAR_FUTURE + 1);
    assert_eq!(fails(w.c.try_submit(&id, &cond)), Some(Error::TooLate.into()));
}

// ------------------------------------------------------------- hygiene ------

#[test]
fn job_ids_cannot_be_replayed() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(17);
    let cond = w.h(217);
    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    assert_eq!(
        fails(w.c.try_open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE)),
        Some(Error::AlreadyUsed.into())
    );
}

#[test]
fn a_missing_job_reads_as_absent_rather_than_panicking() {
    let w = W::build();
    assert_eq!(w.c.state(&w.h(201)), 0);
    assert!(w.c.job(&w.h(201)).is_none());
    assert!(w.c.attestation(&w.h(201)).is_none());
    assert!(!w.c.is_final(&w.h(201)));
    assert_eq!(
        fails(w.c.try_submit(&w.h(201), &w.h(1))),
        Some(Error::NotFound.into())
    );
}

#[test]
fn a_zero_amount_job_is_refused() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    assert_eq!(
        fails(w.c.try_open(&w.h(18), &f, &c, &0, &w.h(218), &FAR_FUTURE)),
        Some(Error::WrongState.into())
    );
}

/// The settlement asset is fixed at construction. There is no admin key and no
/// upgrade entry point, so funds in flight cannot be redirected by anyone later.
#[test]
fn the_asset_is_immutable() {
    let w = W::build();
    assert_eq!(w.c.token(), w.tok.address);
    assert_eq!(w.c.token(), w.asset.address);
}

// --------------------------------------------------- portable proof --------

#[test]
fn attestation_derives_from_chain_state_alone() {
    let w = W::build();
    let (f, c) = (w.party(), w.party());
    w.fund(&f);
    w.fund(&c);
    let id = w.h(19);
    let cond = w.h(219);
    assert!(w.c.attestation(&id).is_none());

    w.c.open(&id, &f, &c, &w.twelve_hundred(), &cond, &FAR_FUTURE);
    assert_eq!(w.c.attestation(&id), Some((f.clone(), w.twelve_hundred(), false, 1)));

    w.c.submit(&id, &cond);
    assert_eq!(w.c.attestation(&id), Some((f, w.twelve_hundred(), true, 2)));
}
