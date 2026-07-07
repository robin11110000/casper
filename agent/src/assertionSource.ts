/**
 * Finds disputed-but-unresolved assertions for the agent to evaluate.
 *
 * NOT exercised against a live node or indexer in this session. Casper has no
 * free/gasless "view call" the way Solidity does -- reading `get_assertion(id)` means
 * either (a) querying the contract's on-chain dictionary storage directly via the
 * node's `state_get_dictionary_item` RPC (needs the exact Odra dictionary-item-key
 * encoding for a `Mapping<u64, Assertion>`, which was not verified in this session),
 * or (b) using an indexer -- CSPR.cloud's REST/Streaming API is the documented tool
 * for this ("query, trades, and portfolio management" per Casper's AI Toolkit) and
 * avoids re-deriving Odra's internal storage layout. This file stubs the interface
 * so either backing implementation is a contained, swappable piece.
 */
export interface DisputedAssertion {
  id: number;
  claim: string;
}

export interface AssertionSource {
  /** Returns disputed assertions this agent has not yet voted on. */
  listPendingVotes(): Promise<DisputedAssertion[]>;
}

/**
 * TODO(unverified): wire this up to CSPR.cloud's dictionary/event query API (or raw
 * `state_get_dictionary_item` RPC calls) once a testnet deployment exists. Until then
 * this throws so the agent fails loudly instead of silently doing nothing.
 */
export class UnimplementedAssertionSource implements AssertionSource {
  async listPendingVotes(): Promise<DisputedAssertion[]> {
    throw new Error(
      "AssertionSource not wired up -- see the TODO in assertionSource.ts. " +
        "Needs a deployed OptimisticOracleV2 plus either a CSPR.cloud API key or " +
        "direct node dictionary queries."
    );
  }
}

/**
 * Fixed-list source for local testing: pass in known disputed assertion ids/claims
 * (e.g. read from a block explorer) instead of discovering them automatically.
 */
export class StaticAssertionSource implements AssertionSource {
  constructor(
    private readonly assertions: DisputedAssertion[],
    private readonly alreadyVoted: Set<number> = new Set()
  ) {}

  async listPendingVotes(): Promise<DisputedAssertion[]> {
    return this.assertions.filter((a) => !this.alreadyVoted.has(a.id));
  }

  markVoted(id: number) {
    this.alreadyVoted.add(id);
  }
}
