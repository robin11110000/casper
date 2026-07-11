import { config, crooSdkKey } from "../config.js";
import { MockCapClient } from "./mockClient.js";
import { RealCapClient } from "./realClient.js";
import type { CapClient } from "./types.js";

export * from "./types.js";

/**
 * Creates the CAP client for one agent (orchestrator or a specialist).
 * `prefix` selects that agent's credential (e.g. RESEARCH -> RESEARCH_CROO_SDK_KEY)
 * when CAP_MODE=real; ignored in mock mode.
 */
export function createCapClient(agentId: string, prefix: string): CapClient {
  if (config.capMode === "real") {
    return new RealCapClient(agentId, config.croo, crooSdkKey(prefix));
  }
  return new MockCapClient(agentId);
}
