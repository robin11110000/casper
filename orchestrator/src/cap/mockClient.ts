import { mockCapNetwork } from "./mockNetwork.js";
import type {
  CapClient,
  CapEvent,
  CapEventHandler,
  CapEventStream,
  DeliverOrderRequest,
  EventTypeName,
  ListOptions,
  NegotiateOrderRequest,
  ServiceListing
} from "./types.js";

class MockEventStream implements CapEventStream {
  private readonly unsubscribers: Array<() => void> = [];
  private readonly anyHandlers: CapEventHandler[] = [];

  constructor(private readonly agentId: string) {}

  on(eventType: EventTypeName | string, handler: CapEventHandler) {
    const unsub = mockCapNetwork.on(this.agentId, eventType, (event: CapEvent) => {
      handler(event);
      for (const h of this.anyHandlers) h(event);
    });
    this.unsubscribers.push(unsub);
  }

  onAny(handler: CapEventHandler) {
    this.anyHandlers.push(handler);
  }

  close() {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
  }
}

/** Thin per-agent view over the shared `mockCapNetwork`, matching the real `AgentClient` surface. */
export class MockCapClient implements CapClient {
  constructor(readonly agentId: string) {}

  async negotiateOrder(req: NegotiateOrderRequest) {
    return mockCapNetwork.negotiateOrder(this.agentId, req);
  }

  async getNegotiation(negotiationId: string) {
    const n = mockCapNetwork.negotiations.get(negotiationId);
    if (!n) throw new Error(`Unknown negotiationId: ${negotiationId}`);
    return n;
  }

  async payOrder(orderId: string) {
    return mockCapNetwork.payOrder(orderId);
  }

  async acceptNegotiation(negotiationId: string) {
    return mockCapNetwork.acceptNegotiation(negotiationId);
  }

  async rejectNegotiation(negotiationId: string, reason: string) {
    mockCapNetwork.rejectNegotiation(negotiationId, reason);
  }

  async deliverOrder(orderId: string, req: DeliverOrderRequest) {
    return mockCapNetwork.deliverOrder(orderId, req);
  }

  async getOrder(orderId: string) {
    const o = mockCapNetwork.orders.get(orderId);
    if (!o) throw new Error(`Unknown orderId: ${orderId}`);
    return o;
  }

  async listOrders(opts?: ListOptions) {
    let orders = [...mockCapNetwork.orders.values()];
    if (opts?.role === "buyer") orders = orders.filter((o) => o.requesterAgentId === this.agentId);
    else if (opts?.role === "provider") orders = orders.filter((o) => o.providerAgentId === this.agentId);
    else orders = orders.filter((o) => o.requesterAgentId === this.agentId || o.providerAgentId === this.agentId);
    if (opts?.status) orders = orders.filter((o) => o.status === opts.status);
    if (opts?.agentId) orders = orders.filter((o) => o.requesterAgentId === opts.agentId || o.providerAgentId === opts.agentId);
    return orders.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  }

  async getDelivery(orderId: string) {
    return mockCapNetwork.getDelivery(orderId);
  }

  async connectWebSocket(): Promise<CapEventStream> {
    return new MockEventStream(this.agentId);
  }

  async registerService(listing: ServiceListing) {
    mockCapNetwork.registerService(listing);
  }

  close() {
    // no-op: nothing to tear down for the in-memory network
  }
}
