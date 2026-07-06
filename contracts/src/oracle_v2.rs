//! Optimistic oracle, v2: the admin-only `arbitrate` step from
//! [`crate::oracle::OptimisticOracleV1`] is replaced with committee majority voting.
//!
//! This module exists to be deployed via [`odra::host::Deployer::try_upgrade`] *in
//! place*, at the exact same contract package address as an already-running
//! [`crate::oracle::OptimisticOracleV1`]. Because its first four fields keep the same
//! name, type and declaration order as v1's, every existing [`crate::oracle::Assertion`]
//! survives the upgrade untouched -- and any `PredictionMarket` that references the
//! oracle's address keeps working without a single line of code changing, since the
//! read/auto-resolve entry points it depends on (`get_assertion`, `resolve_assertion`)
//! keep the same name and signature across versions.
use crate::oracle::{Assertion, AssertionDisputed, AssertionMade, AssertionResolved, BondRedeemed};
use odra::casper_types::U512;
use odra::prelude::*;

/// Emitted for each committee vote that does not yet reach the resolution threshold.
#[odra::event]
pub struct CommitteeVoteCast {
    /// Assertion id being voted on.
    pub assertion_id: u64,
    /// Committee member who voted.
    pub voter: Address,
    /// The outcome they voted for.
    pub outcome: bool
}

/// Oracle v2 errors.
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
    /// A disputed assertion must go through committee voting, not auto-resolution.
    DisputedMustBeArbitrated = 8,
    /// Voting was attempted on an assertion that was never disputed.
    NotDisputed = 9,
    /// The assertion has not reached a final outcome yet.
    NotResolved = 10,
    /// The bond(s) for this assertion have already been paid out.
    BondAlreadySettled = 11,
    /// Caller is not entitled to redeem the bond.
    NotWinner = 12,
    /// Caller is not a member of the arbitration committee.
    NotCommitteeMember = 13,
    /// Caller already voted on this assertion.
    AlreadyVoted = 14,
    /// The contract has not been initialized yet.
    NotInitialized = 15
}

/// Optimistic oracle, v2: disputes are arbitrated by committee majority vote instead
/// of a single admin.
///
/// Field order matters here: `admin`, `challenge_period`, `assertions` and
/// `next_assertion_id` are declared in the exact same order as
/// [`crate::oracle::OptimisticOracleV1`], since Odra addresses `Var`/`Mapping` storage
/// by declaration index, not by name. `admin` is kept only for informational purposes
/// (`get_admin`) -- it no longer gates any entry point.
#[odra::module(
    events = [AssertionMade, AssertionDisputed, AssertionResolved, BondRedeemed, CommitteeVoteCast],
    errors = Error
)]
pub struct OptimisticOracleV2 {
    admin: Var<Address>,
    challenge_period: Var<u64>,
    assertions: Mapping<u64, Assertion>,
    next_assertion_id: Var<u64>,
    committee: Mapping<u64, Address>,
    committee_size: Var<u64>,
    votes: Mapping<(u64, Address), bool>,
    votes_true: Mapping<u64, u64>,
    votes_false: Mapping<u64, u64>
}

#[odra::module]
impl OptimisticOracleV2 {
    /// Fresh-deploy constructor (not used when upgrading an existing v1 package -- see
    /// [`Self::upgrade`]).
    pub fn init(&mut self, admin: Address, challenge_period_seconds: u64, committee: Vec<Address>) {
        self.admin.set(admin);
        self.challenge_period.set(challenge_period_seconds);
        self.next_assertion_id.set(0);
        self.set_committee(committee);
    }

    /// Odra's in-place upgrade hook, invoked by `OptimisticOracleV2::try_upgrade`.
    /// Installs the arbitration committee; every other field is left as-is, so all
    /// assertions created under v1 remain exactly as they were.
    pub fn upgrade(&mut self, committee: Vec<Address>) {
        self.set_committee(committee);
    }

    /// Asserts a claim, backed by the attached native token bond. Identical to v1.
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

    /// Disputes an assertion within its challenge window. Identical to v1.
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
    /// Identical to v1.
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

    /// Committee-vote replacement for v1's admin-only `arbitrate`. Once a majority of
    /// the committee votes the same way, the assertion resolves immediately.
    pub fn vote(&mut self, assertion_id: u64, outcome: bool) {
        let caller = self.env().caller();
        if !self.is_committee_member(caller) {
            self.env().revert(Error::NotCommitteeMember);
        }

        let mut assertion = self.get_assertion(assertion_id);
        if assertion.resolved {
            self.env().revert(Error::AlreadyResolved);
        }
        if !assertion.disputed {
            self.env().revert(Error::NotDisputed);
        }
        if self.votes.get(&(assertion_id, caller)).is_some() {
            self.env().revert(Error::AlreadyVoted);
        }

        self.votes.set(&(assertion_id, caller), outcome);
        if outcome {
            self.votes_true.add(&assertion_id, 1);
        } else {
            self.votes_false.add(&assertion_id, 1);
        }

        self.env().emit_event(CommitteeVoteCast {
            assertion_id,
            voter: caller,
            outcome
        });

        let threshold = self.committee_size.get_or_default() / 2 + 1;
        let votes_true = self.votes_true.get_or_default(&assertion_id);
        let votes_false = self.votes_false.get_or_default(&assertion_id);

        let decided = if votes_true >= threshold {
            Some(true)
        } else if votes_false >= threshold {
            Some(false)
        } else {
            None
        };

        if let Some(final_outcome) = decided {
            assertion.resolved = true;
            assertion.outcome = Some(final_outcome);
            self.assertions.set(&assertion_id, assertion);
            self.env().emit_event(AssertionResolved {
                assertion_id,
                outcome: final_outcome
            });
        }
    }

    /// Pays out the bond(s) of a resolved assertion. Identical to v1.
    pub fn redeem_bond(&mut self, assertion_id: u64) {
        let mut assertion = self.get_assertion(assertion_id);

        if !assertion.resolved {
            self.env().revert(Error::NotResolved);
        }
        if assertion.bond_settled {
            self.env().revert(Error::BondAlreadySettled);
        }

        let (winner, payout): (Address, U512) = if !assertion.disputed {
            (assertion.asserter, assertion.bond)
        } else if assertion.outcome == Some(true) {
            (
                assertion.asserter,
                assertion.bond + assertion.dispute_bond.unwrap_or_default()
            )
        } else {
            (
                assertion
                    .disputer
                    .unwrap_or_revert_with(&self.assertions, Error::AssertionNotFound),
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
    /// Identical name and signature to v1's, so external callers (like
    /// `PredictionMarket`) keep working across the upgrade.
    pub fn get_assertion(&self, assertion_id: u64) -> Assertion {
        self.assertions
            .get(&assertion_id)
            .unwrap_or_revert_with(&self.assertions, Error::AssertionNotFound)
    }

    /// Returns the number of assertions ever created.
    pub fn assertions_count(&self) -> u64 {
        self.next_assertion_id.get_or_default()
    }

    /// Returns the original v1 admin account (kept for reference; it no longer gates
    /// arbitration under v2).
    pub fn get_admin(&self) -> Address {
        self.admin
            .get()
            .unwrap_or_revert_with(&self.assertions, Error::NotInitialized)
    }

    /// Returns the challenge window length, in seconds.
    pub fn get_challenge_period(&self) -> u64 {
        self.challenge_period.get_or_default()
    }

    /// Returns the current committee size.
    pub fn committee_size(&self) -> u64 {
        self.committee_size.get_or_default()
    }

    /// Returns whether `account` is a member of the arbitration committee.
    pub fn is_committee_member(&self, account: Address) -> bool {
        let size = self.committee_size.get_or_default();
        for i in 0..size {
            if self.committee.get(&i) == Some(account) {
                return true;
            }
        }
        false
    }

    fn set_committee(&mut self, committee: Vec<Address>) {
        let size = committee.len() as u64;
        for (i, member) in committee.into_iter().enumerate() {
            self.committee.set(&(i as u64), member);
        }
        self.committee_size.set(size);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef};

    const ONE_HOUR: u64 = 60 * 60;

    fn setup() -> (OptimisticOracleV2HostRef, Address, Address, Address, Address) {
        let test_env = odra_test::env();
        let admin = test_env.get_account(0);
        let asserter = test_env.get_account(1);
        let c1 = test_env.get_account(3);
        let c2 = test_env.get_account(4);
        let c3 = test_env.get_account(5);

        let contract = OptimisticOracleV2::deploy(
            &test_env,
            OptimisticOracleV2InitArgs {
                admin,
                challenge_period_seconds: ONE_HOUR,
                committee: vec![c1, c2, c3]
            }
        );

        (contract, asserter, c1, c2, c3)
    }

    #[test]
    fn majority_vote_resolves_dispute() {
        let (mut contract, asserter, c1, c2, _c3) = setup();
        let test_env = contract.env().clone();
        let disputer = test_env.get_account(2);

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());

        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.set_caller(c1);
        contract.vote(id, true);
        assert!(!contract.get_assertion(id).resolved);

        test_env.set_caller(c2);
        contract.vote(id, true);

        let assertion = contract.get_assertion(id);
        assert!(assertion.resolved);
        assert_eq!(assertion.outcome, Some(true));
    }

    #[test]
    fn non_committee_member_cannot_vote() {
        let (mut contract, asserter, ..) = setup();
        let test_env = contract.env().clone();
        let disputer = test_env.get_account(2);
        let outsider = test_env.get_account(6);

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());
        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.set_caller(outsider);
        assert_eq!(
            contract.try_vote(id, true).unwrap_err(),
            Error::NotCommitteeMember.into()
        );
    }

    #[test]
    fn cannot_vote_twice() {
        let (mut contract, asserter, c1, ..) = setup();
        let test_env = contract.env().clone();
        let disputer = test_env.get_account(2);

        test_env.set_caller(asserter);
        let id = contract.with_tokens(100.into()).assert_claim("claim".to_string());
        test_env.set_caller(disputer);
        contract.with_tokens(100.into()).dispute_assertion(id);

        test_env.set_caller(c1);
        contract.vote(id, true);
        assert_eq!(contract.try_vote(id, true).unwrap_err(), Error::AlreadyVoted.into());
    }
}
