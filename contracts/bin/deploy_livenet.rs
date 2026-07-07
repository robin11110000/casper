//! Deploys `OptimisticOracleV1` and `PredictionMarket` to a live Casper network and
//! runs the full core loop (assert -> dispute -> arbitrate -> market -> buy -> resolve
//! -> claim) as real on-chain transactions.
//!
//! Configure via env vars (see `ODRA_CASPER_LIVENET_*` in odra-casper-rpc-client):
//! `ODRA_CASPER_LIVENET_SECRET_KEY_PATH`, `ODRA_CASPER_LIVENET_NODE_ADDRESS`,
//! `ODRA_CASPER_LIVENET_CHAIN_NAME`. Run with:
//! `cargo run --bin deploy_livenet --features livenet`.
use casper_oracle_market::market::{PredictionMarket, PredictionMarketInitArgs};
use casper_oracle_market::oracle::{OptimisticOracleV1, OptimisticOracleV1InitArgs};
use odra::casper_types::U512;
use odra::host::{Deployer, HostRef, InstallConfig};
use odra::prelude::Addressable;

/// 2 minutes -- demo-friendly; a real deployment would use hours/days.
const CHALLENGE_PERIOD_SECONDS: u64 = 120;

fn main() {
    let env = odra_casper_livenet_env::env();
    let admin = env.caller();
    println!("Deploying and transacting as: {}", admin.to_string());

    env.set_gas(600_000_000_000u64);
    let mut oracle = OptimisticOracleV1::deploy_with_cfg(
        &env,
        OptimisticOracleV1InitArgs {
            admin,
            challenge_period_seconds: CHALLENGE_PERIOD_SECONDS
        },
        InstallConfig::upgradable::<OptimisticOracleV1>()
    );
    println!("OptimisticOracleV1 deployed at: {}", oracle.address().to_string());

    env.set_gas(600_000_000_000u64);
    let mut market = PredictionMarket::deploy(
        &env,
        PredictionMarketInitArgs {
            oracle_address: oracle.address()
        }
    );
    println!("PredictionMarket deployed at: {}", market.address().to_string());

    env.set_gas(60_000_000_000u64);
    let assertion_id = oracle
        .with_tokens(U512::from(2_500_000_000u64))
        .assert_claim("Casper Agentic Buildathon 2026 submission is live".to_string());
    println!("assert_claim -> assertion #{assertion_id}");

    env.set_gas(60_000_000_000u64);
    oracle
        .with_tokens(U512::from(2_500_000_000u64))
        .dispute_assertion(assertion_id);
    println!("dispute_assertion(#{assertion_id})");

    env.set_gas(60_000_000_000u64);
    oracle.arbitrate(assertion_id, true);
    println!("arbitrate(#{assertion_id}, true)");

    env.set_gas(60_000_000_000u64);
    let market_id = market.create_market(assertion_id);
    println!("create_market(#{assertion_id}) -> market #{market_id}");

    env.set_gas(60_000_000_000u64);
    market
        .with_tokens(U512::from(3_000_000_000u64))
        .buy_position(market_id, true);
    println!("buy_position(#{market_id}, YES, 3 CSPR)");

    env.set_gas(60_000_000_000u64);
    market
        .with_tokens(U512::from(1_000_000_000u64))
        .buy_position(market_id, false);
    println!("buy_position(#{market_id}, NO, 1 CSPR)");

    env.set_gas(60_000_000_000u64);
    market.resolve_market(market_id);
    println!("resolve_market(#{market_id})");

    env.set_gas(60_000_000_000u64);
    market.claim_payout(market_id);
    println!("claim_payout(#{market_id})");

    env.set_gas(60_000_000_000u64);
    oracle.redeem_bond(assertion_id);
    println!("redeem_bond(#{assertion_id})");

    println!("\nDone.");
    println!("ORACLE_PACKAGE_HASH={}", oracle.address().to_string());
    println!("MARKET_PACKAGE_HASH={}", market.address().to_string());
}
