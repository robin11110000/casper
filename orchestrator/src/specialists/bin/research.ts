/**
 * Standalone Research specialist process, for CAP_MODE=real: run this with
 * its own RESEARCH_CROO_SDK_KEY (registered as its own Agent at
 * agent.croo.network, service tagged "research") and it listens for
 * negotiations against svc-research-brief indefinitely.
 */
import { createCapClient } from "../../cap/index.js";
import { loadRegistry } from "../../registry.js";
import { runProviderHarness } from "../harness.js";
import { researchWork } from "../research.js";

const listing = loadRegistry().find((s) => s.serviceId === "svc-research-brief");
if (!listing) throw new Error("svc-research-brief not found in registry.json");

const client = createCapClient(listing.agentId, "RESEARCH");
await runProviderHarness(client, listing, researchWork, (msg) => console.log(msg));
console.log(`Research specialist listening (agentId=${listing.agentId}, serviceId=${listing.serviceId})`);
