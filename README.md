# Casper Optimistic Oracle + Prediction Market

An on-chain optimistic oracle -- anyone can assert a fact backed by a bond, anyone
else can dispute it within a challenge window, undisputed assertions auto-resolve --
with a fixed-odds prediction market built on top that settles against the oracle's
resolved outcome. Same shape as UMA's Optimistic Oracle / how Polymarket resolves
markets, built with [Odra](https://odra.dev) for Casper.

**Why Casper:** Casper contracts are upgradeable in place -- no proxy pattern, no
storage migration. `contracts/src/upgrade_demo_tests.rs` deploys a market, buys
positions, then upgrades the oracle's dispute-resolution mechanism (admin arbitration
→ committee majority vote) at the *same contract address*, live, and proves the
existing assertion and the open market are completely unaffected. That upgrade path
is the project's one clear differentiator versus building this on a non-upgradeable
chain.

## Layout

```
contracts/
  src/
    oracle.rs               OptimisticOracleV1: assert / dispute / resolve / admin-arbitrate / redeem bond
    oracle_v2.rs             OptimisticOracleV2: same assertions, committee-vote arbitration instead of admin
    market.rs                PredictionMarket: create_market / buy_position / resolve_market / claim_payout
    upgrade_demo_tests.rs    the live in-place upgrade, end to end
frontend/                    React + TypeScript scaffold, CSPR.click wallet connect (untested -- see below)
agent/                        Autonomous AI arbitration agent: one committee seat, powered by Claude
```

## Contracts

### `OptimisticOracleV1` (`contracts/src/oracle.rs`)

| Entry point | Notes |
| --- | --- |
| `init(admin, challenge_period_seconds)` | `admin` is the v1 arbitrator. |
| `assert_claim(claim) -> u64` *(payable)* | Bond is the attached native token amount; must be non-zero. |
| `dispute_assertion(id)` *(payable)* | Only within the challenge window; counter-bond must be ≥ the original bond. |
| `resolve_assertion(id)` | Anyone, once the window has closed and it was never disputed. Resolves to `true`. |
| `arbitrate(id, outcome)` | Admin-only. Only for disputed assertions. |
| `redeem_bond(id)` | Pays the winning side (asserter if undisputed/upheld, disputer if the dispute succeeded) both bonds. |
| `get_assertion(id) -> Assertion` | View. |

**Arbitration is deliberately a placeholder.** A single admin account deciding
disputed outcomes is not how this would work in production -- it stands in for a
decentralized voting/staking module. `OptimisticOracleV2` shows what swapping that
piece in looks like without touching anything else in the system.

### `OptimisticOracleV2` (`contracts/src/oracle_v2.rs`)

Same `Assertion` data, same `assert_claim` / `dispute_assertion` / `resolve_assertion`
/ `redeem_bond` / `get_assertion` entry points (name- and signature-compatible with
v1), but `arbitrate` is replaced by `vote(id, outcome)`: any of a fixed 3-member
committee can vote, and a 2-of-3 majority resolves the assertion immediately. No
admin involved.

This module is not meant to be deployed fresh -- it's deployed **on top of** an
existing `OptimisticOracleV1` package via `OptimisticOracleV2::try_upgrade(&env,
oracle_v1.address(), OptimisticOracleV2UpgradeArgs { committee })`. Odra addresses
`Var`/`Mapping` storage by field *declaration order*, not by name, so `admin`,
`challenge_period`, `assertions` and `next_assertion_id` are declared in the exact
same order in both modules -- every assertion made under v1 is still there,
untouched, after the upgrade. The new committee-voting fields are appended after.

### `PredictionMarket` (`contracts/src/market.rs`)

| Entry point | Notes |
| --- | --- |
| `init(oracle_address)` | Points at a deployed oracle by contract address. |
| `create_market(assertion_id) -> u64` | Reverts if the assertion doesn't exist. |
| `buy_position(market_id, side)` *(payable)* | Fixed 1:1 odds: attached tokens = shares on that side. `side`: `true` = YES, `false` = NO. |
| `resolve_market(id)` | Anyone, once the referenced assertion has resolved. |
| `claim_payout(id)` | Winners get their stake back plus a pro-rata share of the losing pool. |
| `get_market(id)`, `get_position(id, holder)` | Views. |

The market only ever calls `get_assertion` and reads `.resolved` / `.outcome` off the
oracle -- it has no idea whether disputes are settled by an admin or a committee, which
is exactly what makes the oracle's resolution logic swappable underneath it.

## Building and testing

Odra's proc-macros currently require nightly Rust (`#![feature(box_patterns)]` in
`odra-macros`); a `rust-toolchain.toml` pinning `nightly` is included so `cargo` picks
it up automatically.

```bash
cd contracts
cargo test
```

This runs entirely against Odra's in-memory `odra-test` VM -- no wasm build, no
running node required. It's the fast inner loop for iterating on the contract logic.

### Building the deployable wasm (not done in this session)

Compiling to `wasm32-unknown-unknown` and generating contract schemas needs
`odra-build`/`odra-cli` wired into `Cargo.toml` plus the wasm target installed
(`rustup target add wasm32-unknown-unknown`) -- see the
[Odra docs](https://odra.dev/docs/backends/casper) for the exact `build.rs` /
`bin/build_contract.rs` harness (mirrors `examples/bin/build_contract.rs` in the
[odra repo](https://github.com/odradev/odra)). That step, and an actual testnet
deployment via CSPR.click + a funded faucet account, were out of scope for this
session and haven't been exercised -- treat `contracts/` as verified at the
`cargo test` level only.

### Frontend

```bash
cd frontend
npm install
npm run typecheck   # passes
npm run build       # passes
npm run dev         # not exercised in this session -- see "Frontend" below
```

### Suggested demo script (challenge window set to ~2 minutes for a live demo)

1. `assert_claim("Team X won")` with a bond, from wallet A.
2. `dispute_assertion(id)` with a counter-bond, from wallet B, inside the window.
3. Admin calls `arbitrate(id, true)`.
4. `create_market(id)`, then `buy_position` YES from wallet A and NO from wallet C.
5. `resolve_market(id)`, then `claim_payout(id)` from the winning wallet.
6. Upgrade: `OptimisticOracleV2::try_upgrade` at the same address, with a 3-person
   committee. Show the market from step 4 still resolves/pays out fine, then create a
   *new* disputed assertion and settle it by committee vote instead of admin call.

## Frontend (`frontend/`)

A minimal React + TypeScript (Vite) scaffold: `src/services/casperClient.ts` wraps
CSPR.click connect/signing and Casper JS SDK transaction building/sending;
`src/services/oracleMarket.ts` has one typed function per contract entry point; `App.tsx`
is a bare-bones UI (create-assertion form, dispute/resolve/arbitrate/redeem buttons,
buy YES/NO, resolve/claim, a running deploy log).

`npm install`, `npm run typecheck` and `npm run build` all pass in this session
(against `casper-js-sdk@5.0.12` and `@make-software/csprclick-ui@2.1.0`, the current
versions as of this build) -- so the code compiles and the types line up with the
installed SDKs. **What's not verified: the actual wallet round trip.** There's no
browser + wallet extension + funded testnet account available in this session, so
`connectWallet`/`callEntryPoint` in `casperClient.ts` (CSPR.click's `sign()` result
shape, and whether the `amount` runtime arg is really how Odra's `#[odra(payable)]`
entry points expect bonded native tokens over RPC) have not been exercised end to
end -- see the `TODO(unverified)` comments in that file. Treat this as a compiling
starting point for Day 2 PM / Day 3 of the build order, not as confirmed working
wallet integration.

## Agent (`agent/`)

An autonomous arbitration agent: it holds one seat on `OptimisticOracleV2`'s 3-member
committee, evaluates disputed claims with Claude (`claude-opus-4-8`, adaptive
thinking, the `web_search` tool, structured JSON output), and submits its `vote`
transaction on-chain -- signed with its own Casper key, exactly like a human committee
member would. This is the project's answer to the buildathon's "agentic" requirement:
dispute resolution isn't just admin-then-committee, it's an LLM doing the research and
casting a verifiable, on-chain vote.

| File | Role |
| --- | --- |
| `src/arbiter.ts` | Calls Claude with the claim text; returns `{outcome, confidence, reasoning}`. |
| `src/casperVote.ts` | Builds, signs (local `PrivateKey`, no wallet), and submits `vote(assertion_id, outcome)`. |
| `src/assertionSource.ts` | Finds disputed-but-unvoted assertions. **Unimplemented by default** -- see below. |
| `src/index.ts` | Poll loop: source → arbiter → vote. |

`npm install` and `npm run typecheck`/`build` all pass (against `@anthropic-ai/sdk@0.110.0`
and `casper-js-sdk@5.0.12`, current as of this build), and the `output_config`/
`WebSearchTool20260209`/`ThinkingConfigAdaptive` shapes in `arbiter.ts` were checked
directly against the installed SDK's type declarations, not just the docs. **What's
not verified: an actual end-to-end run.** There's no `ANTHROPIC_API_KEY` or funded
testnet account in this session, so `evaluateClaim` has never been called against the
live API, and `castVote` has never signed a real transaction. More importantly,
**`assertionSource.ts` is intentionally a stub** -- Casper has no free "view call" the
way Solidity does, so discovering "which assertions are disputed" needs either direct
`state_get_dictionary_item` RPC queries (requires reverse-engineering Odra's internal
`Mapping<u64, Assertion>` dictionary-key encoding, not done here) or an indexer like
CSPR.cloud's REST/Streaming API (the documented tool for exactly this in Casper's AI
Toolkit, but no API key available in this session to verify the request shape
against). `UnimplementedAssertionSource` throws on purpose so the agent fails loudly
rather than silently polling nothing; `StaticAssertionSource` is provided for local
testing with manually-supplied claim ids.

```bash
cd agent
npm install
npm run typecheck   # passes
npm run build       # passes
npm start           # not exercised -- needs a live deployment + real credentials
```

## Pitch (community vote via CSPR.fans)

- Lead with the demo: assert → dispute → arbitrate/vote → market → buy → resolve →
  claim, in under 60 seconds, before any architecture talk.
- One-sentence framing: "An optimistic oracle like UMA's, with a Polymarket-style
  market on top -- and one of the arbitrators is an AI agent, not a human."
- Differentiator #1 (Casper): *"the dispute-resolution mechanism can be upgraded in
  place -- no proxy, no migration -- while existing markets stay open. Here's the same
  contract address, running a different arbitration mechanism, mid-flight."*
- Differentiator #2 (agentic): *"one committee seat is a Claude agent that researches
  the disputed claim with web search and casts its own on-chain vote -- the same
  `vote()` call a human committee member makes, verifiable on-chain like any other
  transaction."*
- Say explicitly: arbitration (admin in v1, 3-person human+AI committee in v2) is a
  placeholder for a larger decentralized voting/staking module in production, and the
  AI agent is one arbitrator among several, not a single point of trust.

## Open questions this build resolved

- **Bond token:** native CSPR (attached native token value via `#[odra(payable)]`),
  not a CEP-18 token -- fewer moving parts for the demo.
- **Challenge window:** a configurable `u64` seconds constant passed at `init`, so it
  can be set to minutes for a live demo and hours/days in a real deployment.
- **Odra version:** `2.8.2` (current on crates.io as of this build), confirmed against
  the `release/2.9.0` branch of [odradev/odra](https://github.com/odradev/odra) for
  current module/storage/testing syntax.
