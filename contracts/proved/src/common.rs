//! Shared test harness.
//!
//! Both the correctness suite and the adversarial suite need the same world: a
//! registered contract, a Stellar Asset Contract with the asset's real
//! precision, funded parties, and a way to drive a job end to end. Keeping it
//! here means an attack test cannot accidentally assert against a different
//! setup than a correctness test does.

#![cfg(test)]

// ----------------------------------------------------------------- world ---

pub const UPWORK_FLAT_USD: i128 = 337; // + 50 cents; the flat fee this beats
pub const STARTING_BALANCE: i128 = 100_000_000_000_000_000;
pub const FAR_FUTURE: u64 = 4_000_000_000;

// `pow10` comes from the contract itself, so a test that says "$1,200" is using
// the same conversion the contract uses to read the asset's precision.

/// A `try_` client call: the outer Result is transport/panic, and `Err(Ok(e))`
/// carries a contract error.
pub type TryRes = Result<
    Result<(), soroban_sdk::ConversionError>,
    Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
>;

/// The contract error a call failed with. Reads better than destructuring
/// nested Results inline in the invariant tests.
pub fn fails(r: TryRes) -> Option<soroban_sdk::Error> {
    match r {
        Err(Ok(e)) => Some(e),
        _ => None,
    }
}

pub struct W {
    pub env: Env,
    pub c: ProvedClient<'static>,
    pub tok: TokenClient<'static>,
    pub asset: StellarAssetClient<'static>,
}

impl W {
    pub fn build() -> W {
        let env = Env::default();
        env.mock_all_auths();
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token = sac.address();
        let id = env.register(Proved, (token.clone(),));
        let w = W {
            c: ProvedClient::new(&env, &id),
            tok: TokenClient::new(&env, &token),
            asset: StellarAssetClient::new(&env, &token),
            env,
        };
        for _ in 0..4 {
            let a = w.party();
            w.fund(&a);
        }
        w
    }

    pub fn party(&self) -> Address {
        Address::generate(&self.env)
    }

    pub fn fund(&self, a: &Address) {
        self.asset.mint(a, &STARTING_BALANCE);
    }

    pub fn bal(&self, a: &Address) -> i128 {
        self.tok.balance(a)
    }

    pub fn h(&self, n: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[n; 32])
    }

    /// One whole unit of the settlement asset, in its smallest denomination.
    pub fn one(&self) -> i128 {
        pow10(self.c.decimals())
    }

    /// The demo's job amount: $1,200, whatever the asset's precision.
    pub fn twelve_hundred(&self) -> i128 {
        1_200 * self.one()
    }

    /// Drive one clean, verified settlement and assert it actually released.
    pub fn settle(&self, f: &Address, c: &Address, amount: i128, seed: u8) -> BytesN<32> {
        let id = self.h(seed);
        let cond = self.h(seed.wrapping_add(100));
        self.c.open(&id, f, c, &amount, &cond, &FAR_FUTURE);
        self.c.submit(&id, &cond);
        assert_eq!(self.c.state(&id), 2, "expected Released");
        id
    }
}


use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};

use crate::{Proved, ProvedClient};

/// The contract's own `pow10`, wrapped rather than re-implemented.
///
/// A private item in the crate root is visible crate-wide, so this can call the
/// real one while keeping the shipped WASM byte-identical: widening `pow10`'s
/// visibility would change the compiled binary, and the mainnet deployment is
/// built from this exact source.
pub fn pow10(n: u32) -> i128 {
    crate::pow10(n)
}

