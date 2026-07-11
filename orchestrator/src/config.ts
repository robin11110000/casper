import "dotenv/config";

export type CapMode = "mock" | "real";

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export const config = {
  /** "mock" (default, safe/free/instant) or "real" (Base Mainnet, real USDC -- no testnet exists). */
  capMode: (process.env.CAP_MODE ?? "mock") as CapMode,

  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ORCHESTRATOR_MODEL ?? "claude-sonnet-5",

  /** Shared CAP network config (real mode only) -- field names match the SDK's `Config` type. */
  croo: {
    baseURL: process.env.CROO_API_URL ?? "https://api.croo.network",
    wsURL: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
    rpcURL: process.env.BASE_RPC_URL // defaults to https://mainnet.base.org inside the SDK
  },

  /** Per-subtask hiring timeout: how long to wait for accept -> pay -> deliver before treating it as failed and retrying with a different agent. */
  hireTimeoutMs: Number(process.env.HIRE_TIMEOUT_MS ?? "60000"),
  /** Poll interval while waiting on order status in mock mode / as a WS fallback in real mode. */
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "500"),
  /** How many alternate agents to try per subtask before giving up and reporting partial failure. */
  maxRetriesPerSubtask: Number(process.env.MAX_RETRIES_PER_SUBTASK ?? "1"),

  /** Set true to make the mock verify/content specialists occasionally simulate a bad delivery, to exercise the retry path in the demo. */
  simulateFailures: bool("SIMULATE_FAILURES", false)
};

/** Per-agent CAP credentials. `prefix` is one of ORCHESTRATOR / RESEARCH / VERIFY / CONTENT. */
export function crooSdkKey(prefix: string): string {
  const key = process.env[`${prefix}_CROO_SDK_KEY`] ?? process.env.CROO_SDK_KEY;
  if (config.capMode === "real" && !key) {
    throw new Error(
      `Missing ${prefix}_CROO_SDK_KEY (or CROO_SDK_KEY) -- required in CAP_MODE=real. Register this agent at https://agent.croo.network/ to get one.`
    );
  }
  return key ?? "";
}
