//! Demonstrates Casper's headline differentiator live on testnet: upgrading
//! `OptimisticOracleV1` to `OptimisticOracleV2` **in place**, at the exact same
//! contract package address, with every existing assertion preserved -- no proxy,
//! no migration script. Then exercises the new committee-vote resolution path on a
//! fresh disputed assertion.
//!
//! Run with: `cargo run --bin deploy_livenet_upgrade --features livenet`, after
//! `deploy_livenet` has already installed `OptimisticOracleV1` (address below).
use casper_oracle_market::oracle::OptimisticOracleV1;
use casper_oracle_market::oracle_v2::{OptimisticOracleV2, OptimisticOracleV2UpgradeArgs};
use odra::casper_types::U512;
use odra::host::{Deployer, HostRef, HostRefLoader};
use odra::prelude::*;
use std::str::FromStr;

/// The `OptimisticOracleV1` package deployed by `deploy_livenet` earlier in this session.
const ORACLE_ADDRESS: &str = "hash-9381589625613ac97d30f151a0fe53ba390c1259006f04d6347b20e87e5bb84c";

fn main() {
    let env = odra_casper_livenet_env::env();
    let admin = env.caller();
    println!("Upgrading and transacting as: {}", admin.to_string());

    let oracle_address = Address::from_str(ORACLE_ADDRESS).expect("valid package address");

    // Read the pre-upgrade assertion through the v1 view, purely for the printed diff.
    let oracle_v1 = OptimisticOracleV1::load(&env, oracle_address);
    let before = oracle_v1.get_assertion(0);
    println!(
        "Pre-upgrade (v1) assertion #0: claim={:?} resolved={} outcome={:?}",
        before.claim, before.resolved, before.outcome
    );

    env.set_gas(600_000_000_000u64);
    let mut oracle_v2 = OptimisticOracleV2::try_upgrade(
        &env,
        oracle_address,
        OptimisticOracleV2UpgradeArgs {
            committee: vec![admin]
        }
    )
    .expect("in-place upgrade should succeed");
    println!("Upgraded in place. Same address: {}", oracle_v2.address().to_string());
    assert_eq!(oracle_v2.address(), oracle_address);

    let after = oracle_v2.get_assertion(0);
    println!(
        "Post-upgrade (v2) assertion #0: claim={:?} resolved={} outcome={:?} (unchanged)",
        after.claim, after.resolved, after.outcome
    );
    assert_eq!(before.claim, after.claim);
    assert_eq!(before.resolved, after.resolved);
    assert_eq!(before.outcome, after.outcome);

    // Exercise the new committee-vote resolution path on a fresh assertion.
    env.set_gas(60_000_000_000u64);
    let assertion_id = oracle_v2
        .with_tokens(U512::from(2_000_000_000u64))
        .assert_claim("OptimisticOracleV2 committee voting is live".to_string());
    println!("assert_claim -> assertion #{assertion_id}");

    env.set_gas(60_000_000_000u64);
    oracle_v2
        .with_tokens(U512::from(2_000_000_000u64))
        .dispute_assertion(assertion_id);
    println!("dispute_assertion(#{assertion_id})");

    env.set_gas(60_000_000_000u64);
    oracle_v2.vote(assertion_id, true);
    println!("vote(#{assertion_id}, true) -- 1-of-1 committee reaches majority");

    let voted = oracle_v2.get_assertion(assertion_id);
    println!("assertion #{assertion_id} resolved={} outcome={:?}", voted.resolved, voted.outcome);

    env.set_gas(60_000_000_000u64);
    oracle_v2.redeem_bond(assertion_id);
    println!("redeem_bond(#{assertion_id})");

    println!("\nDone. ORACLE_PACKAGE_HASH (unchanged across the upgrade)={}", oracle_v2.address().to_string());
}
