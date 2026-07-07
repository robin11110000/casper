//! Integration test for the hackathon's headline differentiator: upgrading the
//! oracle's dispute-resolution mechanism *in place*, mid-flight, without migrating
//! any already-open market or assertion. This is the "only on Casper" story -- no
//! proxy contract, no data migration script, just a new WASM version installed on
//! the same contract package.
use crate::market::{PredictionMarket, PredictionMarketHostRef, PredictionMarketInitArgs};
use crate::oracle::{OptimisticOracleV1, OptimisticOracleV1HostRef, OptimisticOracleV1InitArgs};
use crate::oracle_v2::{OptimisticOracleV2, OptimisticOracleV2UpgradeArgs};
use odra::casper_types::U512;
use odra::host::{Deployer, HostRef, InstallConfig};
use odra::prelude::*;

const ONE_HOUR: u64 = 60 * 60;

#[test]
fn resolution_logic_upgrades_without_migrating_open_markets() {
    let test_env = odra_test::env();
    let admin = test_env.get_account(0);
    let asserter = test_env.get_account(1);
    let alice = test_env.get_account(2);
    let bob = test_env.get_account(3);
    let committee: [Address; 3] = [
        test_env.get_account(4),
        test_env.get_account(5),
        test_env.get_account(6)
    ];

    // --- Day 1: deploy v1 (admin-arbitrated) oracle and a market on top of it. ---
    let oracle_v1: OptimisticOracleV1HostRef = OptimisticOracleV1::deploy_with_cfg(
        &test_env,
        OptimisticOracleV1InitArgs {
            admin,
            challenge_period_seconds: ONE_HOUR
        },
        InstallConfig::upgradable::<OptimisticOracleV1>()
    );
    let oracle_address = oracle_v1.address();

    let mut market: PredictionMarketHostRef = PredictionMarket::deploy(
        &test_env,
        PredictionMarketInitArgs { oracle_address }
    );

    test_env.set_caller(asserter);
    let oracle_v1 = oracle_v1;
    let assertion_id = oracle_v1
        .with_tokens(100.into())
        .assert_claim("Team X won the match".to_string());
    let market_id = market.create_market(assertion_id);

    test_env.set_caller(alice);
    market.with_tokens(300.into()).buy_position(market_id, true);
    test_env.set_caller(bob);
    market.with_tokens(100.into()).buy_position(market_id, false);

    // --- Day 2: upgrade the oracle's resolution logic to committee voting, in
    // place, at the same contract address -- while the market above is still open
    // and mid-dispute-window. ---
    let mut oracle_v2 = OptimisticOracleV2::try_upgrade(
        &test_env,
        oracle_address,
        OptimisticOracleV2UpgradeArgs {
            committee: committee.to_vec()
        }
    )
    .expect("in-place upgrade should succeed");

    // The market's `External<OptimisticOracleV1ContractRef>` still points at
    // `oracle_address` -- nothing about the market needed to change.
    assert_eq!(oracle_v2.address(), oracle_address);

    // The pre-upgrade assertion (and its bond, claim text, timing) is untouched.
    let preserved = oracle_v2.get_assertion(assertion_id);
    assert_eq!(preserved.claim, "Team X won the match");
    assert_eq!(preserved.asserter, asserter);
    assert_eq!(preserved.bond, U512::from(100));
    assert!(!preserved.resolved);

    // Undisputed auto-resolution still works exactly as it did under v1.
    test_env.advance_block_time((ONE_HOUR + 1) * 1000);
    oracle_v2.resolve_assertion(assertion_id);
    assert_eq!(oracle_v2.get_assertion(assertion_id).outcome, Some(true));

    // The market -- created before the upgrade even existed -- resolves and pays out
    // normally, still calling the same `get_assertion` entry point by name.
    market.resolve_market(market_id);
    let alice_balance_before = test_env.balance_of(&alice);
    test_env.set_caller(alice);
    market.claim_payout(market_id);
    assert_eq!(
        test_env.balance_of(&alice),
        alice_balance_before + U512::from(400)
    );

    // --- Now demonstrate the new resolution logic on a fresh, post-upgrade
    // assertion: disputes are settled by 2-of-3 committee vote, no admin involved. ---
    test_env.set_caller(asserter);
    let second_id = oracle_v2
        .with_tokens(50.into())
        .assert_claim("Price of Y was Z at time T".to_string());

    let disputer = bob;
    test_env.set_caller(disputer);
    oracle_v2.with_tokens(50.into()).dispute_assertion(second_id);

    test_env.set_caller(committee[0]);
    oracle_v2.vote(second_id, false);
    assert!(!oracle_v2.get_assertion(second_id).resolved);

    test_env.set_caller(committee[1]);
    oracle_v2.vote(second_id, false);

    let final_assertion = oracle_v2.get_assertion(second_id);
    assert!(final_assertion.resolved);
    assert_eq!(final_assertion.outcome, Some(false));

    // The disputer (bob) won the committee vote and redeems both bonds.
    let bob_balance_before = test_env.balance_of(&disputer);
    test_env.set_caller(disputer);
    oracle_v2.redeem_bond(second_id);
    assert_eq!(
        test_env.balance_of(&disputer),
        bob_balance_before + U512::from(100)
    );
}
