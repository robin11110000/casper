/**
 * Standalone Verify specialist process, for CAP_MODE=real: run this with its
 * own VERIFY_CROO_SDK_KEY (registered as its own Agent at
 * agent.croo.network, service tagged "verify") and it listens for
 * negotiations against svc-verify-claim indefinitely.
 */
import { createCapClient } from "../../cap/index.js";
import { loadRegistry } from "../../registry.js";
import { runProviderHarness } from "../harness.js";
import { verifyWork } from "../verify.js";

const listing = loadRegistry().find((s) => s.serviceId === "svc-verify-claim");
if (!listing) throw new Error("svc-verify-claim not found in registry.json");

const client = createCapClient(listing.agentId, "VERIFY");
await runProviderHarness(client, listing, verifyWork, (msg) => console.log(msg));
console.log(`Verify specialist listening (agentId=${listing.agentId}, serviceId=${listing.serviceId})`);
