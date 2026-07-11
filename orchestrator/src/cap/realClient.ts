/**
 * Thin wrapper around the real @croo-network/sdk AgentClient. Every method
 * here delegates straight through -- confirmed against the published 0.2.1
 * package's type declarations (dist/agent-client.d.ts), not just the docs.
 * Not exercised against a live croo_sk_... key or real USDC in this session
 * (Base Mainnet only, no testnet -- see README). `registerService` is a
 * no-op: real service registration happens in the CROO dashboard
 * (agent.croo.network), not through the SDK.
 */
import { AgentClient } from "@croo-network/sdk";
import type { CapClient, CapEventStream, ServiceListing } from "./types.js";

export interface RealCapClientConfig {
  baseURL: string;
  wsURL?: string;
  rpcURL?: string;
}

export class RealCapClient implements CapClient {
  private readonly client: AgentClient;

  constructor(readonly agentId: string, config: RealCapClientConfig, sdkKey: string) {
    this.client = new AgentClient(config, sdkKey);
  }

  negotiateOrder: CapClient["negotiateOrder"] = (req) => this.client.negotiateOrder(req);
  getNegotiation: CapClient["getNegotiation"] = (id) => this.client.getNegotiation(id);
  payOrder: CapClient["payOrder"] = (orderId) => this.client.payOrder(orderId);
  acceptNegotiation: CapClient["acceptNegotiation"] = (id) => this.client.acceptNegotiation(id);
  rejectNegotiation: CapClient["rejectNegotiation"] = (id, reason) => this.client.rejectNegotiation(id, reason);
  deliverOrder: CapClient["deliverOrder"] = (orderId, req) => this.client.deliverOrder(orderId, req);
  getOrder: CapClient["getOrder"] = (orderId) => this.client.getOrder(orderId);
  listOrders: CapClient["listOrders"] = (opts) => this.client.listOrders(opts);
  getDelivery: CapClient["getDelivery"] = (orderId) => this.client.getDelivery(orderId);

  async connectWebSocket(): Promise<CapEventStream> {
    return this.client.connectWebSocket();
  }

  async registerService(_listing: ServiceListing) {
    // Real registration is a dashboard action (Agent Store -> Configure -> + Add Service).
  }

  close() {
    // AgentClient has no explicit teardown; event streams are closed individually.
  }
}
