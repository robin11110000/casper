# Multi-Agent Orchestrator (CROO hackathon)

A caller submits a high-level goal in natural language. The orchestrator breaks it into
subtasks, discovers capable specialist agents, hires the best-fit one for each subtask,
pays them in USDC via CAP (CROO Agent Protocol) escrow as they deliver, and returns a
composed result with a full receipt trail (order IDs, tx hashes, amounts, who did what).

Ships with three self-contained specialist agents so the demo doesn't depend on the
ecosystem being populated yet:

- **research** -- topic -> summarized brief with sources
- **verify** -- claim/output -> confidence score + flags
- **content** -- brief -> formatted output (thread, doc, etc.)

## Why a mock CAP network exists

CROO has **no testnet** -- the protocol only runs on Base Mainnet (chain 8453) with real
USDC (gas is sponsored, transaction fees are not). The SDK also has no public
search/discovery endpoint; the real product's "Agent Store" discovery happens through the
dashboard's Navigator AI assistant, not a callable API.

So this project is built against the real `@croo-network/sdk` (v0.2.1, confirmed against
its published type declarations, not just the docs) behind a `CapClient` interface with two
implementations:

- **`MockCapClient`** (default, `CAP_MODE=mock`) -- an in-memory stand-in for the CROO
  backend + CAPCore/CAPVault contracts. Same order state machine
  (`created -> paid -> completed/rejected/expired`), same event names, same object shapes.
  Free, instant, no account needed -- this is what you run for the demo.
- **`RealCapClient`** (`CAP_MODE=real`) -- a thin delegate to the real `AgentClient`. Wire
  this in once you have funded CROO accounts; no other code changes needed.

Discovery is a static, versioned `registry.json` (capability tags -> our specialists'
service listings) rather than a live search call, matching the brief: *"For your own demo,
you control this by having your specialist agents properly tagged and discoverable."*
Swapping in a real Agent Store query, if/when CROO ships a public one, only touches
`src/registry.ts`.

**Not exercised against a live `croo_sk_...` key or real USDC in this session** -- the
`RealCapClient` code path follows the current SDK exactly but hasn't been run end to end
against the real backend.

## Architecture

```
src/
  config.ts            env config (CAP_MODE, timeouts, model, per-agent credentials)
  decompose.ts          goal decomposition layer (Claude -> flat list of 2-4 subtasks)
  registry.ts           agent discovery layer (registry.json capability matching)
  hire.ts               hiring + payment layer + failure handling (negotiate/accept/pay/deliver, timeout+retry)
  compose.ts            composition + delivery layer (merges outputs, builds receipt trail)
  orchestrate.ts         ties it together: decompose -> order by dependsOn -> hire each -> compose
  cli.ts                entrypoint
  cap/
    types.ts             CapClient interface (mirrors @croo-network/sdk's AgentClient)
    mockNetwork.ts        in-memory CROO backend stand-in
    mockClient.ts         CapClient impl over the mock network
    realClient.ts         CapClient impl over the real SDK
  specialists/
    research.ts verify.ts content.ts   plain work functions (topic/claim/brief -> output), via Claude
    harness.ts             generic provider harness: wires a work function to the CAP order lifecycle
    runAll.ts              starts all 6 registered specialists (3 capabilities x primary+backup) in-process
    bin/*.ts               standalone long-running processes for real mode (one per specialist)
registry.json           the demo's capability registry (6 service listings: 3 capabilities x primary+backup)
```

## Failure handling

Every hire is bounded by `HIRE_TIMEOUT_MS`. If a specialist never responds to a
negotiation, never delivers after payment, or has its negotiation/order rejected, the
orchestrator does not crash -- it retries the same subtask against the next-best
candidate for that capability (`MAX_RETRIES_PER_SUBTASK`, default 1), and if every
candidate strikes out, that subtask is marked `failed` with a reason and the run continues.
The final report's `status` is `success`, `partial_failure`, or `failure` accordingly --
never a silent crash.

`registry.json` includes a backup provider for each capability specifically so this path
is demoable. To force it deterministically:

```bash
FORCE_FAIL_AGENTS=agent-research npm run demo -- "your goal here"
```

The primary research agent will silently ignore its first negotiation (simulating a
non-responsive specialist); the orchestrator times out and hires
`agent-research-backup` instead, and the receipt trail shows both attempts.

## Running the demo (mock mode, default)

```bash
cd orchestrator
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run demo -- "Research the current state of A2A payment protocols, verify the claims, and write a short Twitter thread about it."
```

This starts all three specialist agents in-process against the mock CAP network, runs the
full decompose -> discover -> hire -> pay -> deliver -> compose flow, and prints the
composed result plus the full receipt trail. No CROO account or USDC required.

## Switching to real CROO accounts

1. For each of the 7 identities (orchestrator + 3 specialists x primary/backup, or just
   the 3 primaries if you skip the backup-fallback story), register an Agent at
   [agent.croo.network](https://agent.croo.network/), save its API key, and fund its AA
   wallet with a small amount of USDC on Base.
2. For each specialist, configure a Service in the dashboard matching the corresponding
   entry in `registry.json` (same name/price/SLA/deliverable type) so the tags line up.
3. Put each API key in `.env` (`RESEARCH_CROO_SDK_KEY=croo_sk_...`, etc.) and set
   `CAP_MODE=real`.
4. Run each specialist as its own long-lived process (`npm run specialist:research`, etc.)
   and the orchestrator (`npm run demo -- "..."`) separately -- real specialists listen for
   negotiations indefinitely rather than exiting after one goal.

## Notes

- Order lifecycle and method names (`negotiateOrder -> acceptNegotiation -> payOrder ->
  deliverOrder`) match the real SDK, not the `createOrder/awaitDelivery/confirmSettlement`
  naming in the original brief -- settlement is automatic, triggered by `deliverOrder`.
- `deliverableSchema`/`requirements` are plain strings on the wire (JSON-encoded where
  structured); this codebase JSON-stringifies/parses at the CAP boundary and works with
  plain objects everywhere else.
