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

### Building the deployable wasm

`build.rs` + `bin/build_contract.rs` wire `odra-build`'s `ODRA_MODULE` env var
into a `#[cfg(odra_module = "...")]` flag, so each module compiles to its own wasm
binary:

```bash
cd contracts
for MOD in OptimisticOracleV1 OptimisticOracleV2 PredictionMarket; do
  ODRA_MODULE=$MOD cargo +nightly build -Z build-std=core,alloc \
    --target wasm32-unknown-unknown --release --bin build_contract
  cp ../target/wasm32-unknown-unknown/release/build_contract.wasm "wasm/$MOD.wasm"
done
```

Casper's on-chain wasm validator rejects the `bulk-memory` proposal that LLVM emits
by default for `wasm32-unknown-unknown`. Negating individual `-C target-feature`s
wasn't enough -- LLVM still lowered some `memcpy`/`memset` calls to bulk-memory ops
regardless -- so `.cargo/config.toml` builds with `-C target-cpu=mvp` instead (the
true zero-extensions baseline), plus `-Z build-std=core,alloc` to rebuild `core`
itself with that flag, since the prebuilt sysroot rustup ships isn't compiled with
it. `-C link-arg=--allow-undefined` is also required so the linker leaves Casper's
host functions (`casper_revert`, `casper_get_key`, ...) as unresolved wasm imports
instead of erroring.

### Live testnet deployment

Deployed and exercised end-to-end on Casper testnet via `bin/deploy_livenet.rs`
(`odra_casper_livenet_env`, the same `Deployer`/`HostRef` API as the local tests,
but issuing real signed transactions):

```bash
cd contracts
ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/path/to/secret_key.pem \
ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.casper.network/rpc \
ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test \
ODRA_CASPER_LIVENET_EVENTS_URL=https://node.testnet.casper.network/events \
cargo +nightly run --release --bin deploy_livenet --features livenet
```

Deployed contracts (testnet):

| Contract | Package hash |
| --- | --- |
| `OptimisticOracleV1` | `hash-9381589625613ac97d30f151a0fe53ba390c1259006f04d6347b20e87e5bb84c` |
| `PredictionMarket` | `hash-0a897d4de8d91d4236439b560e90edb57bcf7a7e6438d4160cc28f2d5d5d9cb2` |

Full core loop run as real transactions in a single session (all links resolve on
[testnet.cspr.live](https://testnet.cspr.live)):

1. `assert_claim("Casper Agentic Buildathon 2026 submission is live")` ->
   [`de6fa0b7...`](https://testnet.cspr.live/transaction/de6fa0b799101db51b34ac87aafb5926a9321bc0544b3737005992f93d891b28)
2. `dispute_assertion(#0)` ->
   [`7f19ee9f...`](https://testnet.cspr.live/transaction/7f19ee9fb5c9dc5c99429dd3660062697c5ff883d9c5249d7854dcb06db39be6)
3. `arbitrate(#0, true)` ->
   [`285fa035...`](https://testnet.cspr.live/transaction/285fa03556ba889bb69486e38c2467ca9af9b42ff4d00d4efe72b432cdbc43d9)
4. `create_market(#0)` -> market #0 ->
   [`383c2819...`](https://testnet.cspr.live/transaction/383c28195ef644d622b8caaac4631d8ac8cd7f3354c0ff328a3a755c9401f100)
5. `buy_position(#0, YES, 3 CSPR)` ->
   [`7409da52...`](https://testnet.cspr.live/transaction/7409da52c28d26fb55b6b90b7ecd136e672f4c10a046496b7a48833fc246e681)
6. `buy_position(#0, NO, 1 CSPR)` ->
   [`5150cb82...`](https://testnet.cspr.live/transaction/5150cb825ec5501b41b0ffecc8f4ae06e594d19e57cb4da04c73d820d4bcefda)
7. `resolve_market(#0)` ->
   [`0def0343...`](https://testnet.cspr.live/transaction/0def0343af185a1044e3b8d448e39aba8e85ec47a27edd73ab40eb67d8de00ee)
8. `claim_payout(#0)` ->
   [`b6342503...`](https://testnet.cspr.live/transaction/b6342503461daa98ab08165cadbc5e42e666da0beccb97a2d104fcfa380cf859)
9. `redeem_bond(#0)` ->
   [`ab41d386...`](https://testnet.cspr.live/transaction/ab41d386ae4441391c9ef31cf695aa97fb230d02fa26f0afe72d8f1f7bfcebad)

One caveat found only by deploying live: `assert_claim`/`dispute_assertion`/
`resolve_assertion` originally compared `env().get_block_time()` (milliseconds)
directly against a `challenge_period_seconds` value, making the real challenge
window ~1000x shorter than configured. The local `odra-test` mock env's
`advance_block_time` is also milliseconds, so the bug was self-consistent in tests
and only surfaced against a real node's wall-clock time -- fixed by switching to
`get_block_time_secs()`.

### Live in-place upgrade (the headline differentiator)

`bin/deploy_livenet_upgrade.rs` then upgraded the deployed `OptimisticOracleV1`
package to `OptimisticOracleV2` **in place**, at the exact same contract address,
via `OptimisticOracleV2::try_upgrade` -- no proxy, no migration script:

```bash
cd contracts
# same env vars as above
cargo +nightly run --release --bin deploy_livenet_upgrade --features livenet
```

1. Read pre-upgrade assertion #0 through the v1 interface: `resolved=true`,
   `outcome=Some(true)` (settled earlier in the run above).
2. Upgraded in place ->
   [`9d79c101...`](https://testnet.cspr.live/transaction/9d79c101677859627a3641e1517bf511d305ec640f7a8902398625788fb039ef) --
   same package hash before and after:
   `hash-9381589625613ac97d30f151a0fe53ba390c1259006f04d6347b20e87e5bb84c`.
3. Read assertion #0 again through the *v2* interface: identical claim, `resolved`
   and `outcome` -- confirmed byte-for-byte preserved across the upgrade.
4. `assert_claim("OptimisticOracleV2 committee voting is live")` -> assertion #1 ->
   [`adb5e5a1...`](https://testnet.cspr.live/transaction/adb5e5a156ab32cd67be1bf5daf3f0a474e2cdfbbb58a95ceabb89b7818ce101)
5. `dispute_assertion(#1)` ->
   [`7e1b9853...`](https://testnet.cspr.live/transaction/7e1b985369aaf22b65d2106f35dcd6a35eaddd7213aeaf0c976edd062a80d9c0)
6. `vote(#1, true)` -- a 1-member committee (threshold `size/2 + 1 = 1`, so a single
   vote is majority) resolves it via the *new* voting mechanism, no admin call ->
   [`6ce46fd4...`](https://testnet.cspr.live/transaction/6ce46fd4967f85e89dc93b829fa86d7e95fdaa7e1ffe75b198e5b6d82b711109)
7. `redeem_bond(#1)` ->
   [`7c58be23...`](https://testnet.cspr.live/transaction/7c58be2363ad23b238a10037effc5991ced43dbf722b314ea5fc22884cc3e508)

A real Casper contract's dispute-resolution logic was swapped from
admin-arbitrated to committee-vote-resolved, live, at an address that had already
processed a real dispute -- with the pre-existing assertion data provably untouched.

### Frontend

```bash
cd frontend
npm install
npm run typecheck   # passes
npm run build       # passes
npm run dev         # not exercised in this session -- see "Frontend" below
```

This exact script -- assert, dispute, arbitrate, market, buy, resolve, claim,
redeem, then the live in-place upgrade and a committee-resolved dispute -- is what
"Live testnet deployment" and "Live in-place upgrade" above actually ran, as real
signed transactions, not a rehearsal.

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
  contract address, running a different arbitration mechanism, mid-flight."* Not a
  slide -- see "Live in-place upgrade" above for the actual testnet transaction that
  did this.
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
