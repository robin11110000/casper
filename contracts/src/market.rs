//! A simple fixed-odds prediction market that settles against an
//! [`crate::oracle::OptimisticOracleV1`] assertion. Buying a side pools native tokens
//! 1:1 into shares; once the referenced assertion resolves, winners split the losing
//! side's pool pro-rata to their stake.
use crate::oracle::OptimisticOracleV1ContractRef;
use odra::casper_types::U512;
use odra::prelude::*;

/// A market referencing a single oracle assertion.
#[odra::odra_type]
pub struct Market {
    /// Sequential identifier.
    pub id: u64,
    /// The oracle assertion this market settles against.
    pub assertion_id: u64,
    /// Total native tokens staked on YES.
    pub yes_pool: U512,
    /// Total native tokens staked on NO.
    pub no_pool: U512,
    /// Whether the market has been settled.
    pub resolved: bool,
    /// Final outcome, once settled.
    pub outcome: Option<bool>
}

/// A user's stake in a market.
#[odra::odra_type]
pub struct Position {
    /// The market this position belongs to.
    pub market_id: u64,
    /// The position holder.
    pub holder: Address,
    /// Amount staked on YES.
    pub yes_amount: U512,
    /// Amount staked on NO.
    pub no_amount: U512,
    /// Whether the winnings have already been claimed.
    pub claimed: bool
}

/// Emitted when a market is created.
#[odra::event]
pub struct MarketCreated {
    /// Market id.
    pub market_id: u64,
    /// Assertion the market settles against.
    pub assertion_id: u64
}

/// Emitted when a position is bought.
#[odra::event]
pub struct PositionBought {
    /// Market id.
    pub market_id: u64,
    /// Buyer.
    pub holder: Address,
    /// `true` for YES, `false` for NO.
    pub side: bool,
    /// Amount staked.
    pub amount: U512
}

/// Emitted when a market is settled.
#[odra::event]
pub struct MarketResolved {
    /// Market id.
    pub market_id: u64,
    /// Final outcome.
    pub outcome: bool
}

/// Emitted when a position holder claims their payout.
#[odra::event]
pub struct PayoutClaimed {
    /// Market id.
    pub market_id: u64,
    /// Claimant.
    pub holder: Address,
    /// Amount paid out.
    pub amount: U512
}

/// Market errors.
#[odra::odra_error]
pub enum Error {
    /// A position must be bought with a non-zero amount.
    ZeroAmount = 1,
    /// No market exists with the given id.
    MarketNotFound = 2,
    /// The market has already been settled.
    MarketAlreadyResolved = 3,
    /// The market has not been settled yet.
    MarketNotResolved = 4,
    /// The referenced assertion has not reached a final outcome yet.
    AssertionNotResolved = 5,
    /// The caller has no winning stake to claim.
    NothingToClaim = 6,
    /// The caller has already claimed their payout for this market.
    AlreadyClaimed = 7
}

/// Prediction market contract.
#[odra::module(
    events = [MarketCreated, PositionBought, MarketResolved, PayoutClaimed],
    errors = Error
)]
pub struct PredictionMarket {
    oracle: External<OptimisticOracleV1ContractRef>,
    markets: Mapping<u64, Market>,
    next_market_id: Var<u64>,
    positions: Mapping<(u64, Address), Position>
}

#[odra::module]
impl PredictionMarket {
    /// Initializes the market contract, pointing it at a deployed oracle.
    pub fn init(&mut self, oracle_address: Address) {
        self.oracle.set(oracle_address);
        self.next_market_id.set(0);
    }

    /// Creates a market for an existing oracle assertion. Reverts if the assertion
    /// does not exist.
    pub fn create_market(&mut self, assertion_id: u64) -> u64 {
        self.oracle.get_assertion(assertion_id);

        let id = self.next_market_id.get_or_default();
        self.next_market_id.set(id + 1);

        self.markets.set(
            &id,
            Market {
                id,
                assertion_id,
                yes_pool: U512::zero(),
                no_pool: U512::zero(),
                resolved: false,
                outcome: None
            }
        );

        self.env().emit_event(MarketCreated {
            market_id: id,
            assertion_id
        });

        id
    }

    /// Buys into one side of the market at fixed 1:1 odds (one token in, one share
    /// out), backed by the attached native token amount.
    #[odra(payable)]
    pub fn buy_position(&mut self, market_id: u64, side: bool) {
        let amount = self.env().attached_value();
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }

        let mut market = self.get_market(market_id);
        if market.resolved {
            self.env().revert(Error::MarketAlreadyResolved);
        }

        if side {
            market.yes_pool += amount;
        } else {
            market.no_pool += amount;
        }
        self.markets.set(&market_id, market);

        let caller = self.env().caller();
        let mut position = self.get_position(market_id, caller);
        if side {
            position.yes_amount += amount;
        } else {
            position.no_amount += amount;
        }
        self.positions.set(&(market_id, caller), position);

        self.env().emit_event(PositionBought {
            market_id,
            holder: caller,
            side,
            amount
        });
    }

    /// Settles the market against its oracle assertion's outcome. Callable by anyone,
    /// once the assertion has resolved.
    pub fn resolve_market(&mut self, market_id: u64) {
        let mut market = self.get_market(market_id);
        if market.resolved {
            self.env().revert(Error::MarketAlreadyResolved);
        }

        let assertion = self.oracle.get_assertion(market.assertion_id);
        if !assertion.resolved {
            self.env().revert(Error::AssertionNotResolved);
        }
        let outcome = match assertion.outcome {
            Some(outcome) => outcome,
            None => self.env().revert(Error::AssertionNotResolved)
        };

        market.resolved = true;
        market.outcome = Some(outcome);
        self.markets.set(&market_id, market);

        self.env().emit_event(MarketResolved { market_id, outcome });
    }

    /// Pays out a resolved market's winnings to the caller: their own stake back, plus
    /// their pro-rata share of the losing side's pool.
    pub fn claim_payout(&mut self, market_id: u64) {
        let market = self.get_market(market_id);
        if !market.resolved {
            self.env().revert(Error::MarketNotResolved);
        }
        let outcome = match market.outcome {
            Some(outcome) => outcome,
            None => self.env().revert(Error::MarketNotResolved)
        };

        let caller = self.env().caller();
        let mut position = self.get_position(market_id, caller);
        if position.claimed {
            self.env().revert(Error::AlreadyClaimed);
        }

        let (winning_pool, user_stake) = if outcome {
            (market.yes_pool, position.yes_amount)
        } else {
            (market.no_pool, position.no_amount)
        };
        let losing_pool = market.yes_pool + market.no_pool - winning_pool;

        if user_stake.is_zero() {
            self.env().revert(Error::NothingToClaim);
        }

        let bonus = if winning_pool.is_zero() {
            U512::zero()
        } else {
            losing_pool * user_stake / winning_pool
        };
        let payout = user_stake + bonus;

        position.claimed = true;
        self.positions.set(&(market_id, caller), position);

        self.env().transfer_tokens(&caller, &payout);
        self.env().emit_event(PayoutClaimed {
            market_id,
            holder: caller,
            amount: payout
        });
    }

    /// Returns a market's state, reverting if it does not exist.
    pub fn get_market(&self, market_id: u64) -> Market {
        self.markets
            .get(&market_id)
            .unwrap_or_revert_with(&self.markets, Error::MarketNotFound)
    }

    /// Returns a holder's position in a market (defaults to an empty position).
    pub fn get_position(&self, market_id: u64, holder: Address) -> Position {
        self.positions
            .get(&(market_id, holder))
            .unwrap_or(Position {
                market_id,
                holder,
                yes_amount: U512::zero(),
                no_amount: U512::zero(),
                claimed: false
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oracle::{OptimisticOracleV1, OptimisticOracleV1HostRef, OptimisticOracleV1InitArgs};
    use odra::host::{Deployer, HostRef, InstallConfig};

    const ONE_HOUR: u64 = 60 * 60;

    struct Setup {
        oracle: OptimisticOracleV1HostRef,
        market: PredictionMarketHostRef,
        admin: Address,
        asserter: Address,
        alice: Address,
        bob: Address
    }

    fn setup() -> Setup {
        let test_env = odra_test::env();
        let admin = test_env.get_account(0);
        let asserter = test_env.get_account(1);
        let alice = test_env.get_account(2);
        let bob = test_env.get_account(3);

        let oracle = OptimisticOracleV1::deploy_with_cfg(
            &test_env,
            OptimisticOracleV1InitArgs {
                admin,
                challenge_period_seconds: ONE_HOUR
            },
            InstallConfig::upgradable::<OptimisticOracleV1>()
        );

        let market = PredictionMarket::deploy(
            &test_env,
            PredictionMarketInitArgs {
                oracle_address: oracle.address()
            }
        );

        Setup {
            oracle,
            market,
            admin,
            asserter,
            alice,
            bob
        }
    }

    #[test]
    fn full_lifecycle_yes_wins() {
        let Setup {
            mut oracle,
            mut market,
            admin: _,
            asserter,
            alice,
            bob
        } = setup();
        let test_env = market.env().clone();

        test_env.set_caller(asserter);
        let assertion_id = oracle.with_tokens(100.into()).assert_claim("Team X won".to_string());

        let market_id = market.create_market(assertion_id);

        test_env.set_caller(alice);
        market.with_tokens(300.into()).buy_position(market_id, true);

        test_env.set_caller(bob);
        market.with_tokens(100.into()).buy_position(market_id, false);

        test_env.advance_block_time((ONE_HOUR + 1) * 1000);
        oracle.resolve_assertion(assertion_id);

        market.resolve_market(market_id);
        let resolved = market.get_market(market_id);
        assert!(resolved.resolved);
        assert_eq!(resolved.outcome, Some(true));

        let alice_balance_before = test_env.balance_of(&alice);
        test_env.set_caller(alice);
        market.claim_payout(market_id);
        // Alice staked all of the winning pool, so she gets her stake back plus the
        // entire losing pool.
        assert_eq!(
            test_env.balance_of(&alice),
            alice_balance_before + U512::from(400)
        );

        // Bob backed the losing side: nothing to claim.
        test_env.set_caller(bob);
        assert_eq!(
            market.try_claim_payout(market_id).unwrap_err(),
            Error::NothingToClaim.into()
        );
    }

    #[test]
    fn payout_splits_pro_rata_among_multiple_winners() {
        let Setup {
            mut oracle,
            mut market,
            admin,
            asserter,
            alice,
            bob
        } = setup();
        let test_env = market.env().clone();
        let carol = test_env.get_account(4);

        test_env.set_caller(asserter);
        let assertion_id = oracle.with_tokens(50.into()).assert_claim("claim".to_string());

        let market_id = market.create_market(assertion_id);

        // Alice and Bob both back YES with different amounts; Carol backs NO.
        test_env.set_caller(alice);
        market.with_tokens(100.into()).buy_position(market_id, true);
        test_env.set_caller(bob);
        market.with_tokens(300.into()).buy_position(market_id, true);
        test_env.set_caller(carol);
        market.with_tokens(200.into()).buy_position(market_id, false);

        // Dispute and arbitrate to false this time, so NO wins.
        let disputer = carol;
        test_env.set_caller(disputer);
        oracle.with_tokens(50.into()).dispute_assertion(assertion_id);
        test_env.set_caller(admin);
        oracle.arbitrate(assertion_id, false);

        market.resolve_market(market_id);

        let carol_balance_before = test_env.balance_of(&carol);
        test_env.set_caller(carol);
        market.claim_payout(market_id);
        // Carol was the sole NO backer: she gets her 200 back plus the full 400 YES pool.
        assert_eq!(
            test_env.balance_of(&carol),
            carol_balance_before + U512::from(600)
        );

        test_env.set_caller(alice);
        assert_eq!(
            market.try_claim_payout(market_id).unwrap_err(),
            Error::NothingToClaim.into()
        );
    }

    #[test]
    fn cannot_claim_before_market_resolved() {
        let Setup {
            oracle,
            mut market,
            asserter,
            alice,
            ..
        } = setup();
        let test_env = market.env().clone();

        test_env.set_caller(asserter);
        let assertion_id = oracle.with_tokens(100.into()).assert_claim("claim".to_string());
        let market_id = market.create_market(assertion_id);

        test_env.set_caller(alice);
        market.with_tokens(100.into()).buy_position(market_id, true);

        assert_eq!(
            market.try_claim_payout(market_id).unwrap_err(),
            Error::MarketNotResolved.into()
        );
    }

    #[test]
    fn cannot_resolve_market_before_assertion_resolved() {
        let Setup {
            oracle,
            mut market,
            asserter,
            ..
        } = setup();
        let test_env = market.env().clone();

        test_env.set_caller(asserter);
        let assertion_id = oracle.with_tokens(100.into()).assert_claim("claim".to_string());
        let market_id = market.create_market(assertion_id);

        assert_eq!(
            market.try_resolve_market(market_id).unwrap_err(),
            Error::AssertionNotResolved.into()
        );
    }
}
