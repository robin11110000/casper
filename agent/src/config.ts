import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  /** Anthropic API key for the arbitration model. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  /** Model used to evaluate disputed claims. */
  model: process.env.ARBITER_MODEL ?? "claude-opus-4-8",

  /** "casper-test" for testnet, "casper" for mainnet. */
  networkName: process.env.CASPER_NETWORK ?? "casper-test",
  /** RPC node URL used to read events and submit the vote transaction. */
  nodeRpcUrl: process.env.CASPER_NODE_RPC_URL ?? "https://node.testnet.casper.network/rpc",
  /** Node event-stream URL (CES / SSE) used to detect disputes. */
  nodeEventStreamUrl:
    process.env.CASPER_EVENT_STREAM_URL ?? "https://node.testnet.casper.network/events",

  /** Contract package hash of the deployed OptimisticOracleV2. */
  oracleContractPackageHash: process.env.ORACLE_PACKAGE_HASH ?? "",
  /** Hex-encoded secp256k1/ed25519 private key for this agent's committee seat. */
  agentPrivateKeyHex: process.env.AGENT_PRIVATE_KEY_HEX ?? "",
  /** Standard payment amount (in motes) attached to the vote transaction. */
  paymentMotes: Number(process.env.AGENT_PAYMENT_MOTES ?? "3000000000"),

  /** How often to poll for new disputes if the event stream is unavailable. */
  pollIntervalMs: Number(process.env.AGENT_POLL_INTERVAL_MS ?? "15000")
};

export function requireOracleConfig() {
  required("ORACLE_PACKAGE_HASH", config.oracleContractPackageHash || undefined);
  required("AGENT_PRIVATE_KEY_HEX", config.agentPrivateKeyHex || undefined);
}
