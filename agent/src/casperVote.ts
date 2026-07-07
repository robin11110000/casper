/**
 * Submits this agent's committee vote on-chain: `OptimisticOracleV2.vote(assertion_id,
 * outcome)`, signed with the agent's own Casper key. Structurally identical to any
 * other committee member's vote -- the contract has no idea this one came from an LLM.
 *
 * Built on the same `ContractCallBuilder` + `Args`/`CLValue` shapes verified against
 * casper-js-sdk@5.0.12 in the frontend service layer (`frontend/src/services/
 * casperClient.ts`). Signing here is local (`PrivateKey.sign`), not a wallet round
 * trip, since this is a server-side agent, not a browser client.
 */
import {
  Args,
  CLValue,
  ContractCallBuilder,
  HttpHandler,
  KeyAlgorithm,
  PrivateKey,
  RpcClient
} from "casper-js-sdk";
import { config } from "./config.js";

const rpcClient = new RpcClient(new HttpHandler(config.nodeRpcUrl));

function loadAgentKey(): PrivateKey {
  if (!config.agentPrivateKeyHex) {
    throw new Error("AGENT_PRIVATE_KEY_HEX is not set");
  }
  return PrivateKey.fromHex(config.agentPrivateKeyHex, KeyAlgorithm.ED25519);
}

/** Submits `vote(assertion_id, outcome)` and returns the transaction hash. */
export async function castVote(assertionId: number, outcome: boolean) {
  const agentKey = loadAgentKey();

  const transaction = new ContractCallBuilder()
    .from(agentKey.publicKey)
    .byPackageHash(config.oracleContractPackageHash)
    .entryPoint("vote")
    .runtimeArgs(
      Args.fromMap({
        assertion_id: CLValue.newCLUint64(assertionId),
        outcome: CLValue.newCLValueBool(outcome)
      })
    )
    .chainName(config.networkName)
    .payment(config.paymentMotes)
    .build();

  transaction.sign(agentKey);

  return rpcClient.putTransaction(transaction);
}
