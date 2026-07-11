/**
 * Standalone Content specialist process, for CAP_MODE=real: run this with
 * its own CONTENT_CROO_SDK_KEY (registered as its own Agent at
 * agent.croo.network, service tagged "content") and it listens for
 * negotiations against svc-content-format indefinitely.
 */
import { createCapClient } from "../../cap/index.js";
import { loadRegistry } from "../../registry.js";
import { runProviderHarness } from "../harness.js";
import { contentWork } from "../content.js";

const listing = loadRegistry().find((s) => s.serviceId === "svc-content-format");
if (!listing) throw new Error("svc-content-format not found in registry.json");

const client = createCapClient(listing.agentId, "CONTENT");
await runProviderHarness(client, listing, contentWork, (msg) => console.log(msg));
console.log(`Content specialist listening (agentId=${listing.agentId}, serviceId=${listing.serviceId})`);
