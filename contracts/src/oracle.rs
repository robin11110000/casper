//! Optimistic oracle: anyone can assert a claim backed by a bond, anyone else can
//! dispute it within a challenge window, and disputes are settled by an admin-controlled
//! arbitration step. Undisputed assertions auto-resolve to `true` once the window closes.
use odra::casper_types::U512;
use odra::prelude::*;

/// A single asserted claim and its lifecycle state.
#[odra::odra_type]
pub struct Assertion {
    /// Sequential identifier.
    pub id: u64,
    /// Human-readable claim text (or a hash of off-chain data).
    pub claim: String,
    /// Account that made the assertion and posted `bond`.
    pub asserter: Address,
    /// Bond posted by the asserter, in motes.
    pub bond: U512,
    /// Block time the assertion was created.
    pub created_at: u64,
    /// Block time after which an undisputed assertion can be resolved.
    pub challenge_window_end: u64,
    /// Whether a dispute has been raised.
    pub disputed: bool,
    /// Account that disputed the assertion, if any.
    pub disputer: Option<Address>,
    /// Counter-bond posted by the disputer, if any.
    pub dispute_bond: Option<U512>,
    /// Whether the assertion has reached a final outcome.
    pub resolved: bool,
    /// Final outcome once resolved: `true` if the claim held, `false` otherwise.
    pub outcome: Option<bool>,
    /// Whether the winning bond(s) have been paid out.
    pub bond_settled: bool
}

/// Events emitted by the oracle.
#[odra::event]
pub struct AssertionMade {
    /// Assertion id.
    pub assertion_id: u64,
    /// Asserter address.
    pub asserter: Address,
    /// Bond amount.
    pub bond: U512,
    /// The asserted claim.
    pub claim: String
}

/// Emitted when an assertion is disputed.
#[odra::event]
pub struct AssertionDisputed {
    /// Assertion id.
    pub assertion_id: u64,
    /// Disputer address.
    pub disputer: Address,
    /// Counter-bond amount.
    pub counter_bond: U512
}

/// Emitted when an assertion reaches a final outcome.
#[odra::event]
pub struct AssertionResolved {
    /// Assertion id.
    pub assertion_id: u64,
    /// Final outcome.
    pub outcome: bool
}

/// Emitted when bonds are paid out to the winning party.
#[odra::event]
pub struct BondRedeemed {
    /// Assertion id.
    pub assertion_id: u64,
    /// Winning account.
    pub winner: Address,
    /// Amount paid out (asserter bond, plus dispute bond if there was one).
    pub amount: U512
}

/// Oracle errors.
#[odra::odra_error]
pub enum Error {
    /// An assertion or dispute must be backed by a non-zero bond.
    ZeroBond = 1,
    /// No assertion exists with the given id.
    AssertionNotFound = 2,
    /// The assertion has already been disputed.
    AlreadyDisputed = 3,
    /// The assertion has already reached a final outcome.
    AlreadyResolved = 4,
    /// The challenge window has already closed; disputes are no longer accepted.
    ChallengeWindowClosed = 5,
    /// The challenge window has not closed yet.
    ChallengeWindowNotClosed = 6,
    /// The counter-bond must be at least as large as the original bond.
    InsufficientCounterBond = 7,
    /// A disputed assertion must go through arbitration, not auto-resolution.
    DisputedMustBeArbitrated = 8,
    /// Arbitration was attempted on an assertion that was never disputed.
    NotDisputed = 9,
    /// Caller is not the oracle admin.
    NotAdmin = 10,
    /// The assertion has not reached a final outcome yet.
    NotResolved = 11,
    /// The bond(s) for this assertion have already been paid out.
    BondAlreadySettled = 12,
    /// Caller is not entitled to redeem the bond.
    NotWinner = 13,
    /// The contract has not been initialized yet.
    NotInitialized = 14
}

/// Optimistic oracle, v1: disputes are arbitrated by a single admin account.
///
/// Field order matters: [`crate::oracle_v2::OptimisticOracleV2`] preserves this exact
/// prefix of fields so that an in-place upgrade keeps every existing assertion intact.
#[odra::module(
    events = [AssertionMade, AssertionDisputed, AssertionResolved, BondRedeemed],
    errors = Error
)]
pub struct OptimisticOracleV1 {
    admin: Var<Address>,
    challenge_period: Var<u64>,
    assertions: Mapping<u64, Assertion>,
    next_assertion_id: Var<u64>
}

#[odra::module]
impl OptimisticOracleV1 {
    /// Initializes the oracle with an admin account (the arbitrator for v1) and the
    /// challenge window length, in seconds.
    pub fn init(&mut self, admin: Address, challenge_period_seconds: u64) {
        self.admin.set(admin);
        self.challenge_period.set(challenge_period_seconds);
        self.next_assertion_id.set(0);
    }

    /// Asserts a claim, backed by the attached native token bond. Returns the new
    /// assertion id.
    #[odra(payable)]
    pub fn assert_claim(&mut self, claim: String) -> u64 {
        let bond = self.env().attached_value();
        if bond.is_zero() {
            self.env().revert(Error::ZeroBond);
        }

        let caller = self.env().caller();
        let id = self.next_assertion_id.get_or_default();
        self.next_assertion_id.set(id + 1);

        let created_at = self.env().get_block_time();
        let challenge_window_end = created_at + self.challenge_period.get_or_default();

        self.assertions.set(
            &id,
            Assertion {
                id,
                claim: claim.clone(),
                asserter: caller,
                bond,
                created_at,
                challenge_window_end,
                disputed: false,
                disputer: None,
                dispute_bond: None,
                resolved: false,
                outcome: None,
                bond_settled: false
            }
        );

        self.env().emit_event(AssertionMade {
            assertion_id: id,
            asserter: caller,
            bond,
            claim
        });

        id
    }

    /// Disputes an assertion within its challenge window, backed by a counter-bond at
    /// least as large as the original bond.
    #[odra(payable)]
    pub fn dispute_assertion(&mut self, assertion_id: u64) {
        let mut assertion = self.get_assertion(assertion_id);

        if assertion.resolved {
            self.env().revert(Error::AlreadyResolved);
        }
        if assertion.disputed {
            self.env().revert(Error::AlreadyDisputed);
        }
        if self.env().get_block_time() > assertion.challenge_window_end {
            self.env().revert(Error::ChallengeWindowClosed);
        }

        let counter_bond = self.env().attached_value();
        if counter_bond < assertion.bond {
            self.env().revert(Error::InsufficientCounterBond);
        }

        let caller = self.env().caller();
        assertion.disputed = true;
        assertion.disputer = Some(caller);
        assertion.dispute_bond = Some(counter_bond);
        self.assertions.set(&assertion_id, assertion);

        self.env().emit_event(AssertionDisputed {
            assertion_id,
            disputer: caller,
            counter_bond
        });
    }

    /// Resolves an undisputed assertion to `true` once its challenge window has closed.
    /// Callable by anyone.
    pub fn resolve_assertion(&mut self, assertion_id: u64) {
        let mut assertion = self.get_assertion(assertion_id);

        if assertion.resolved {
            self.env().revert(Error::AlreadyResolved);
        }
        if assertion.disputed {
            self.env().revert(Error::DisputedMustBeArbitrated);
        }
        if self.env().get_block_time() <= assertion.challenge_window_end {
            self.env().revert(Error::ChallengeWindowNotClosed);
        }

        assertion.resolved = true;
        assertion.outcome = Some(true);
        self.assertions.set(&assertion_id, assertion);

        self.env().emit_event(AssertionResolved {
            assertion_id,
            outcome: true
        });
    }

    /// Admin-only resolution path for a disputed assertion.
    ///
    /// This is deliberately a placeholder for a decentralized voting module: for the
    /// hackathon demo a single trusted admin account decides disputed outcomes. See
    /// [`crate::oracle_v2::OptimisticOracleV2::vote`] for a committee-based upgrade of
    /// this exact mechanism, applied in place via `try_upgrade`.
    pub fn arbitrate(&mut self, assertion_id: u64, outcome: bool) {
        self.assert_admin();

        let mut assertion = self.get_assertion(assertion_id);
        if assertion.resolved {
            self.env().revert(Error::AlreadyResolved);
        }
        if !assertion.disputed {
            self.env().revert(Error::NotDisputed);
        }

        assertion.resolved = true;
        assertion.outcome = Some(outcome);
        self.assertions.set(&assertion_id, assertion);

        self.env().emit_event(AssertionResolved {
            assertion_id,
            outcome
        });
    }

    /// Pays out the bond(s) of a resolved assertion to whichever side won: the asserter
    /// if undisputed or upheld, the disputer if the dispute succeeded.
    pub fn redeem_bond(&mut self, assertion_id: u64) {
        let mut assertion = self.get_assertion(assertion_id);

        if !assertion.resolved {
            self.env().revert(Error::NotResolved);
        }
        if assertion.bond_settled {
            self.env().revert(Error::BondAlreadySettled);
        }

        let (winner, payout) = if !assertion.disputed {
            (assertion.asserter, assertion.bond)
        } else if assertion.outcome == Some(true) {
            (
                assertion.asserter,
                assertion.bond + assertion.dispute_bond.unwrap_or_default()
            )
        } else {
            (
                assertion.disputer.unwrap_or_revert_with(&self.assertions, Error::AssertionNotFound),
                assertion.bond + assertion.dispute_bond.unwrap_or_default()
            )
        };

        let caller = self.env().caller();
        if caller != winner {
            self.env().revert(Error::NotWinner);
        }

        assertion.bond_settled = true;
        self.assertions.set(&assertion_id, assertion);

        self.env().transfer_tokens(&winner, &payout);
        self.env().emit_event(BondRedeemed {
            assertion_id,
            winner,
            amount: payout
        });
    }

    /// Returns the full state of an assertion, reverting if it does not exist.
    pub fn get_assertion(&self, assertion_id: u64) -> Assertion {
        self.assertions
            .get(&assertion_id)
            .unwrap_or_revert_with(&self.assertions, Error::AssertionNotFound)
    }

    /// Returns the number of assertions ever created.
    pub fn assertions_count(&self) -> u64 {
        self.next_assertion_id.get_or_default()
    }

    /// Returns the current admin/arbitrator account.
    pub fn get_admin(&self) -> Address {
        self.admin
            .get()
            .unwrap_or_revert_with(&self.assertions, Error::NotInitialized)
    }

    /// Returns the challenge window length, in seconds.
    pub fn get_challenge_period(&self) -> u64 {
        self.challenge_period.get_or_default()
    }

    fn assert_admin(&self) {
        let caller = self.env().caller();
        if Some(caller) != self.admin.get() {
            self.env().revert(Error::NotAdmin);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef, InstallConfig};

    const ONE_HOUR: u64 = 60 * 60;

    fn setup() -> (OptimisticOracleV1HostRef, Address, Address, Address) {
        let test_env = odra_test::env();
        let admin = test_env.get_account(0);
        let asserter = test_env.get_account(1);
        let disputer = test_env.get_account(2);

        let contract = OptimisticOracleV1::deploy_with_cfg(
            &test_env,
            OptimisticOracleV1InitArgs {
                admin,
                challenge_period_seconds: ONE_HOUR
            },
            InstallConfig::upgradable::<OptimisticOracleV1>()
        );

        (contract, admin, asserter, disputer)
    }

    #[test]
    fn undisputed_assertion_resolves_true() {
        let (mut contract, _admin, asserter, _disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("Team X won".to_string());

        let assertion = contract.get_assertion(id);
        assert_eq!(assertion.asserter, asserter);
        assert_eq!(assertion.bond, 100.into());
        assert!(!assertion.resolved);
        assert!(!assertion.disputed);

        // Too early: window has not closed yet.
        assert_eq!(
            contract.try_resolve_assertion(id).unwrap_err(),
            Error::ChallengeWindowNotClosed.into()
        );

        test_env.advance_block_time(ONE_HOUR + 1);
        contract.resolve_assertion(id);

        let assertion = contract.get_assertion(id);
        assert!(assertion.resolved);
        assert_eq!(assertion.outcome, Some(true));

        test_env.emitted_event(
            &contract,
            AssertionResolved {
                assertion_id: id,
                outcome: true
            }
        );

        // Asserter reclaims their own bond.
        let balance_before = test_env.balance_of(&asserter);
        contract.redeem_bond(id);
        assert_eq!(test_env.balance_of(&asserter), balance_before + U512::from(100));
        assert!(contract.get_assertion(id).bond_settled);

        // Cannot redeem twice.
        assert_eq!(
            contract.try_redeem_bond(id).unwrap_err(),
            Error::BondAlreadySettled.into()
        );
    }

    #[test]
    fn cannot_resolve_a_disputed_assertion_directly() {
        let (mut contract, _admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("Price was Z".to_string());

        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.advance_block_time(ONE_HOUR + 1);
        assert_eq!(
            contract.try_resolve_assertion(id).unwrap_err(),
            Error::DisputedMustBeArbitrated.into()
        );
    }

    #[test]
    fn dispute_window_closed_rejects_late_disputes() {
        let (contract, _admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("late claim".to_string());

        test_env.advance_block_time(ONE_HOUR + 1);
        test_env.set_caller(disputer);
        assert_eq!(
            contract.with_tokens(100.into()).try_dispute_assertion(id).unwrap_err(),
            Error::ChallengeWindowClosed.into()
        );
    }

    #[test]
    fn dispute_requires_matching_counter_bond() {
        let (contract, _admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());

        test_env.set_caller(disputer);
        assert_eq!(
            contract.with_tokens(50.into()).try_dispute_assertion(id).unwrap_err(),
            Error::InsufficientCounterBond.into()
        );
    }

    #[test]
    fn disputed_and_arbitrated_true_pays_asserter_both_bonds() {
        let (mut contract, admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());

        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.set_caller(admin);
        contract.arbitrate(id, true);

        let assertion = contract.get_assertion(id);
        assert!(assertion.resolved);
        assert_eq!(assertion.outcome, Some(true));

        let balance_before = test_env.balance_of(&asserter);
        test_env.set_caller(asserter);
        contract.redeem_bond(id);
        assert_eq!(test_env.balance_of(&asserter), balance_before + U512::from(200));

        // The disputer, having lost, cannot redeem.
        test_env.set_caller(disputer);
        assert_eq!(
            contract.try_redeem_bond(id).unwrap_err(),
            Error::BondAlreadySettled.into()
        );
    }

    #[test]
    fn disputed_and_arbitrated_false_pays_disputer_both_bonds() {
        let (mut contract, admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());

        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.set_caller(admin);
        contract.arbitrate(id, false);

        let assertion = contract.get_assertion(id);
        assert_eq!(assertion.outcome, Some(false));

        let balance_before = test_env.balance_of(&disputer);
        test_env.set_caller(disputer);
        contract.redeem_bond(id);
        assert_eq!(test_env.balance_of(&disputer), balance_before + U512::from(200));

        // The bond has already been paid out to the disputer; a second redemption
        // attempt (by anyone) is rejected before a winner is even computed.
        test_env.set_caller(asserter);
        assert_eq!(
            contract.try_redeem_bond(id).unwrap_err(),
            Error::BondAlreadySettled.into()
        );
    }

    #[test]
    fn only_admin_can_arbitrate() {
        let (mut contract, _admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());

        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.set_caller(disputer);
        assert_eq!(
            contract.try_arbitrate(id, true).unwrap_err(),
            Error::NotAdmin.into()
        );
    }

    #[test]
    fn asserting_with_zero_bond_reverts() {
        let (mut contract, _admin, asserter, _disputer) = setup();
        let test_env = contract.env().clone();
        test_env.set_caller(asserter);
        assert_eq!(
            contract.try_assert_claim("claim".to_string()).unwrap_err(),
            Error::ZeroBond.into()
        );
    }

    #[test]
    fn cannot_dispute_twice() {
        let (contract, _admin, asserter, disputer) = setup();
        let test_env = contract.env().clone();

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());

        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        let second_disputer = test_env.get_account(3);
        test_env.set_caller(second_disputer);
        assert_eq!(
            contract.with_tokens(100.into()).try_dispute_assertion(id).unwrap_err(),
            Error::AlreadyDisputed.into()
        );
    }

    #[test]
    fn unknown_assertion_reverts() {
        let (contract, ..) = setup();
        assert_eq!(
            contract.try_get_assertion(999).unwrap_err(),
            Error::AssertionNotFound.into()
        );
    }
}
