/**
 * Autonomous arbitration agent main loop: poll for disputed assertions, evaluate each
 * with Claude, cast this agent's committee vote on-chain.
 *
 * This is one seat on OptimisticOracleV2's 3-member committee (see
 * contracts/src/oracle_v2.rs) -- a 2-of-3 majority resolves the assertion. Run one
 * instance per AI committee seat; humans can hold the other seat(s) and call `vote`
 * directly, exactly as in the contract's own tests.
 */
import { config, requireOracleConfig } from "./config.js";
import { evaluateClaim } from "./arbiter.js";
import { castVote } from "./casperVote.js";
import { AssertionSource, UnimplementedAssertionSource } from "./assertionSource.js";

const votedOn = new Set<number>();

async function tick(source: AssertionSource) {
  const pending = await source.listPendingVotes();
  for (const assertion of pending) {
    if (votedOn.has(assertion.id)) continue;

    console.log(`[agent] evaluating assertion #${assertion.id}: "${assertion.claim}"`);
    const verdict = await evaluateClaim(assertion.claim);
    console.log(
      `[agent] verdict for #${assertion.id}: outcome=${verdict.outcome} ` +
        `confidence=${verdict.confidence.toFixed(2)}\n  reasoning: ${verdict.reasoning}`
    );

    const result = await castVote(assertion.id, verdict.outcome);
    console.log(`[agent] vote submitted for #${assertion.id}:`, result);
    votedOn.add(assertion.id);
  }
}

async function main() {
  requireOracleConfig();
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  // Swap in a real AssertionSource (CSPR.cloud-backed, or direct node dictionary
  // queries) once deployed -- see assertionSource.ts.
  const source: AssertionSource = new UnimplementedAssertionSource();

  console.log(`[agent] starting, polling every ${config.pollIntervalMs}ms`);
  for (;;) {
    try {
      await tick(source);
    } catch (err) {
      console.error("[agent] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
