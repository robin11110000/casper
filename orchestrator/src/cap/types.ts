/**
 * CAP (CROO Agent Protocol) types, re-exported from the real @croo-network/sdk
 * (confirmed against the published 0.2.1 package, not just the docs) so the
 * mock and real clients produce identical shapes. Order state machine:
 * created -> paid -> completed | rejected | expired -- settlement is
 * automatic, CAPVault releases escrow the instant a provider delivers.
 */
import type {
  Negotiation,
  NegotiateOrderRequest,
  AcceptNegotiationResult,
  Order,
  PayOrderResult,
  Delivery,
  DeliverOrderRequest,
  DeliverOrderResult,
  Event as SdkEvent,
  EventTypeName,
  ListOptions
} from "@croo-network/sdk";

export type {
  Negotiation,
  NegotiateOrderRequest,
  AcceptNegotiationResult,
  Order,
  PayOrderResult,
  Delivery,
  DeliverOrderRequest,
  DeliverOrderResult,
  EventTypeName,
  ListOptions
};
export type CapEvent = SdkEvent;
export type CapEventHandler = (event: CapEvent) => void;

/** Off-chain-only concept: not part of the SDK. Registered in the CROO dashboard for real agents; mirrored here as a static config so discovery works without a public search API. */
export interface ServiceListing {
  serviceId: string;
  agentId: string;
  name: string;
  description: string;
  tags: string[];
  price: number; // USDC
  slaSeconds: number;
  deliverableType: "text" | "schema";
}

export interface CapEventStream {
  on(eventType: EventTypeName | string, handler: CapEventHandler): void;
  onAny(handler: CapEventHandler): void;
  close(): void;
}

/**
 * Subset of AgentClient actually used by the orchestrator + specialists.
 * RealCapClient delegates straight to @croo-network/sdk's AgentClient;
 * MockCapClient implements the same surface against the in-memory network.
 */
export interface CapClient {
  readonly agentId: string;

  // Requester side
  negotiateOrder(req: NegotiateOrderRequest): Promise<Negotiation>;
  getNegotiation(negotiationId: string): Promise<Negotiation>;
  payOrder(orderId: string): Promise<PayOrderResult>;

  // Provider side
  acceptNegotiation(negotiationId: string): Promise<AcceptNegotiationResult>;
  rejectNegotiation(negotiationId: string, reason: string): Promise<void>;
  deliverOrder(orderId: string, req: DeliverOrderRequest): Promise<DeliverOrderResult>;

  // Shared reads
  getOrder(orderId: string): Promise<Order>;
  /** Negotiation carries no orderId field in the SDK -- the requester correlates the order created on acceptance by listing its own orders and matching negotiationId. */
  listOrders(opts?: ListOptions): Promise<Order[]>;
  getDelivery(orderId: string): Promise<Delivery>;

  connectWebSocket(): Promise<CapEventStream>;

  /** Registers a service listing for discovery. No-op on the real client -- registration happens via the CROO dashboard, not the SDK. */
  registerService(listing: ServiceListing): Promise<void>;

  close(): void;
}
