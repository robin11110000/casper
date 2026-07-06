/**
 * Typed wrappers around the OptimisticOracleV1/V2 and PredictionMarket entry points,
 * built on top of `callEntryPoint` from `./casperClient`. Mirrors the Rust contract
 * signatures in `contracts/src/oracle.rs` and `contracts/src/market.rs`.
 *
 * Not exercised against a live deployment in this session -- see the README's
 * "Frontend" section.
 */
import type { ICSPRClickSDK } from "@make-software/csprclick-core-types";
import { CLValue } from "casper-js-sdk";
import { callEntryPoint } from "./casperClient";
import { config } from "../config";

type ClickRef = ICSPRClickSDK;

interface CallOpts {
  senderPublicKeyHex: string;
}

/** `assert_claim(claim: String) -> u64`, bonded with `bondMotes`. */
export function assertClaim(
  clickRef: ClickRef,
  claim: string,
  bondMotes: string,
  opts: CallOpts
) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.oracleContractPackageHash,
    entryPoint: "assert_claim",
    runtimeArgs: { claim: CLValue.newCLString(claim) },
    senderPublicKeyHex: opts.senderPublicKeyHex,
    attachedMotes: bondMotes
  });
}

/** `dispute_assertion(assertion_id: u64)`, bonded with `counterBondMotes`. */
export function disputeAssertion(
  clickRef: ClickRef,
  assertionId: number,
  counterBondMotes: string,
  opts: CallOpts
) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.oracleContractPackageHash,
    entryPoint: "dispute_assertion",
    runtimeArgs: { assertion_id: CLValue.newCLUint64(assertionId) },
    senderPublicKeyHex: opts.senderPublicKeyHex,
    attachedMotes: counterBondMotes
  });
}

/** `resolve_assertion(assertion_id: u64)`. Callable by anyone once the window closes. */
export function resolveAssertion(clickRef: ClickRef, assertionId: number, opts: CallOpts) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.oracleContractPackageHash,
    entryPoint: "resolve_assertion",
    runtimeArgs: { assertion_id: CLValue.newCLUint64(assertionId) },
    senderPublicKeyHex: opts.senderPublicKeyHex
  });
}

/** `arbitrate(assertion_id: u64, outcome: bool)`. Admin-only (v1) / committee `vote` (v2). */
export function arbitrate(
  clickRef: ClickRef,
  assertionId: number,
  outcome: boolean,
  opts: CallOpts
) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.oracleContractPackageHash,
    entryPoint: "arbitrate",
    runtimeArgs: {
      assertion_id: CLValue.newCLUint64(assertionId),
      outcome: CLValue.newCLValueBool(outcome)
    },
    senderPublicKeyHex: opts.senderPublicKeyHex
  });
}

/** `redeem_bond(assertion_id: u64)`, callable by whichever side won. */
export function redeemBond(clickRef: ClickRef, assertionId: number, opts: CallOpts) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.oracleContractPackageHash,
    entryPoint: "redeem_bond",
    runtimeArgs: { assertion_id: CLValue.newCLUint64(assertionId) },
    senderPublicKeyHex: opts.senderPublicKeyHex
  });
}

/** `create_market(assertion_id: u64) -> u64`. */
export function createMarket(clickRef: ClickRef, assertionId: number, opts: CallOpts) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.marketContractPackageHash,
    entryPoint: "create_market",
    runtimeArgs: { assertion_id: CLValue.newCLUint64(assertionId) },
    senderPublicKeyHex: opts.senderPublicKeyHex
  });
}

/** `buy_position(market_id: u64, side: bool)`, backed by `amountMotes`. */
export function buyPosition(
  clickRef: ClickRef,
  marketId: number,
  side: "yes" | "no",
  amountMotes: string,
  opts: CallOpts
) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.marketContractPackageHash,
    entryPoint: "buy_position",
    runtimeArgs: {
      market_id: CLValue.newCLUint64(marketId),
      side: CLValue.newCLValueBool(side === "yes")
    },
    senderPublicKeyHex: opts.senderPublicKeyHex,
    attachedMotes: amountMotes
  });
}

/** `resolve_market(market_id: u64)`. Callable by anyone once the assertion resolves. */
export function resolveMarket(clickRef: ClickRef, marketId: number, opts: CallOpts) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.marketContractPackageHash,
    entryPoint: "resolve_market",
    runtimeArgs: { market_id: CLValue.newCLUint64(marketId) },
    senderPublicKeyHex: opts.senderPublicKeyHex
  });
}

/** `claim_payout(market_id: u64)`. */
export function claimPayout(clickRef: ClickRef, marketId: number, opts: CallOpts) {
  return callEntryPoint(clickRef, {
    contractPackageHash: config.marketContractPackageHash,
    entryPoint: "claim_payout",
    runtimeArgs: { market_id: CLValue.newCLUint64(marketId) },
    senderPublicKeyHex: opts.senderPublicKeyHex
  });
}
