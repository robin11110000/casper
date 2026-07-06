/**
 * Deployment-specific addresses and settings. Fill these in after `cargo odra build`
 * + a real testnet deployment -- nothing here has been exercised against a live
 * contract in this session.
 */
export const config = {
  /** CSPR.click app id, from https://csprclick.io after registering the app. */
  csprClickAppId: import.meta.env.VITE_CSPRCLICK_APP_ID ?? "",
  /** "casper-test" for testnet, "casper" for mainnet. */
  networkName: import.meta.env.VITE_CASPER_NETWORK ?? "casper-test",
  /** RPC node URL used to read contract state and send deploys. */
  nodeRpcUrl: import.meta.env.VITE_CASPER_NODE_RPC_URL ?? "https://node.testnet.casper.network/rpc",
  /** Contract package hash of the deployed OptimisticOracleV1 (or later, V2). */
  oracleContractPackageHash: import.meta.env.VITE_ORACLE_PACKAGE_HASH ?? "",
  /** Contract package hash of the deployed PredictionMarket. */
  marketContractPackageHash: import.meta.env.VITE_MARKET_PACKAGE_HASH ?? "",
  /** Standard payment amount (in motes) attached to entry-point calls. */
  defaultPaymentMotes: "3000000000"
};
