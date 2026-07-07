/**
 * Deployment-specific addresses and settings. Defaults point at the live testnet
 * deployment from this session's `deploy_livenet` run (see README for the full
 * transaction history); override via .env for a different deployment.
 */
export const config = {
  /**
   * CSPR.click app id, registered at https://console.cspr.build. The default
   * `csprclick-template` id only works for local development on localhost -- a
   * real deployment (e.g. Vercel) needs its own registered app id.
   */
  csprClickAppId: import.meta.env.VITE_CSPRCLICK_APP_ID ?? "csprclick-template",
  /** "casper-test" for testnet, "casper" for mainnet. */
  networkName: import.meta.env.VITE_CASPER_NETWORK ?? "casper-test",
  /** RPC node URL used to read contract state and send deploys. */
  nodeRpcUrl: import.meta.env.VITE_CASPER_NODE_RPC_URL ?? "https://node.testnet.casper.network/rpc",
  /** Contract package hash of the deployed OptimisticOracleV1 (or later, V2). */
  oracleContractPackageHash:
    import.meta.env.VITE_ORACLE_PACKAGE_HASH ??
    "hash-9381589625613ac97d30f151a0fe53ba390c1259006f04d6347b20e87e5bb84c",
  /** Contract package hash of the deployed PredictionMarket. */
  marketContractPackageHash:
    import.meta.env.VITE_MARKET_PACKAGE_HASH ??
    "hash-0a897d4de8d91d4236439b560e90edb57bcf7a7e6438d4160cc28f2d5d5d9cb2",
  /** Standard payment amount (in motes) attached to entry-point calls. */
  defaultPaymentMotes: "3000000000"
};
