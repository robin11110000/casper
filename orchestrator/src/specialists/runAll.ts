/**
 * Starts every registered specialist provider in-process. Perfect for the
 * mock demo (one command, one process, whole economy running). In real mode
 * this is still valid (nothing here is mock-specific) but each specialist
 * would more realistically run as its own long-lived process with its own
 * CROO account -- see src/specialists/bin/*.ts.
 */
import { createCapClient } from "../cap/index.js";
import { loadRegistry } from "../registry.js";
import { runProviderHarness, type ProviderHarness } from "./harness.js";
import { researchWork } from "./research.js";
import { verifyWork } from "./verify.js";
import { contentWork } from "./content.js";
import type { WorkFn } from "./types.js";

function baseAgentId(agentId: string): string {
  return agentId.replace(/-backup$/, "");
}

const WORK_BY_BASE_AGENT: Record<string, WorkFn> = {
  "agent-research": researchWork,
  "agent-verify": verifyWork,
  "agent-content": contentWork
};

/** ORCHESTRATOR / RESEARCH / RESEARCH_BACKUP / VERIFY / ... -- used for {PREFIX}_CROO_SDK_KEY in real mode. */
export function envPrefixFor(agentId: string): string {
  return agentId.replace(/^agent-/, "").replace(/-/g, "_").toUpperCase();
}

export async function startAllSpecialists(log: (msg: string) => void = () => {}): Promise<() => void> {
  const harnesses: ProviderHarness[] = [];
  for (const listing of loadRegistry()) {
    const work = WORK_BY_BASE_AGENT[baseAgentId(listing.agentId)];
    if (!work) continue;
    const client = createCapClient(listing.agentId, envPrefixFor(listing.agentId));
    harnesses.push(await runProviderHarness(client, listing, work, log));
  }
  return () => harnesses.forEach((h) => h.stop());
}
