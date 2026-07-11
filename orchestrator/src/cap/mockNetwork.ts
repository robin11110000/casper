/**
 * In-memory stand-in for the CROO backend + CAPCore/CAPVault contracts. There
 * is no CROO testnet (Base Mainnet only, real USDC), so this lets the whole
 * negotiate -> pay -> deliver flow run instantly and for free during
 * development/demo. Produces the exact same object shapes as the real SDK
 * (see cap/types.ts) and emits the same event type strings, so
 * `MockCapClient` and `RealCapClient` are interchangeable behind `CapClient`.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { EventType } from "@croo-network/sdk";
import type {
  CapEvent,
  DeliverOrderRequest,
  Delivery,
  Negotiation,
  NegotiateOrderRequest,
  Order,
  ServiceListing
} from "./types.js";

const now = () => new Date().toISOString();

class MockCapNetwork {
  private readonly bus = new EventEmitter();
  readonly services = new Map<string, ServiceListing>();
  readonly negotiations = new Map<string, Negotiation>();
  readonly orders = new Map<string, Order>();
  readonly deliveries = new Map<string, Delivery>();

  registerService(listing: ServiceListing) {
    this.services.set(listing.serviceId, listing);
  }

  listServices(): ServiceListing[] {
    return [...this.services.values()];
  }

  negotiateOrder(requesterAgentId: string, req: NegotiateOrderRequest): Negotiation {
    const service = this.mustGetService(req.serviceId);
    const negotiation: Negotiation = {
      negotiationId: randomUUID(),
      serviceId: req.serviceId,
      requesterAgentId,
      providerAgentId: service.agentId,
      requirements: req.requirements ?? "",
      status: "pending",
      rejectReason: "",
      metadata: req.metadata ?? "",
      expiresAt: "",
      createdTime: now(),
      updatedTime: now()
    };
    this.negotiations.set(negotiation.negotiationId, negotiation);
    this.emit(EventType.NegotiationCreated, { negotiation_id: negotiation.negotiationId }, service.agentId);
    return negotiation;
  }

  acceptNegotiation(negotiationId: string): { negotiation: Negotiation; order: Order } {
    const negotiation = this.mustGetNegotiation(negotiationId);
    const service = this.mustGetService(negotiation.serviceId);
    negotiation.status = "accepted";
    negotiation.updatedTime = now();

    const order: Order = {
      orderId: randomUUID(),
      negotiationId,
      chainOrderId: "",
      serviceId: negotiation.serviceId,
      requesterAgentId: negotiation.requesterAgentId,
      providerAgentId: negotiation.providerAgentId,
      buyerUserId: "",
      requesterWalletAddress: "",
      providerWalletAddress: "",
      price: String(service.price),
      paymentToken: "USDC",
      deliveryWindow: service.slaSeconds,
      status: "created",
      rejectReason: "",
      createTxHash: `0xmock-create-${randomUUID()}`,
      payTxHash: "",
      deliverTxHash: "",
      rejectTxHash: "",
      clearTxHash: "",
      slaDeadline: new Date(Date.now() + service.slaSeconds * 1000).toISOString(),
      payDeadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      createdTime: now(),
      updatedTime: now(),
      createdAt: now(),
      paidAt: "",
      deliveredAt: "",
      rejectedAt: "",
      expiredAt: ""
    };
    this.orders.set(order.orderId, order);
    this.emit(EventType.OrderCreated, { order_id: order.orderId }, order.requesterAgentId, order.providerAgentId);
    return { negotiation, order };
  }

  rejectNegotiation(negotiationId: string, reason: string) {
    const negotiation = this.mustGetNegotiation(negotiationId);
    negotiation.status = "rejected";
    negotiation.rejectReason = reason;
    negotiation.updatedTime = now();
    this.emit(EventType.NegotiationRejected, { negotiation_id: negotiationId, reason }, negotiation.requesterAgentId);
  }

  payOrder(orderId: string): { order: Order; txHash: string } {
    const order = this.mustGetOrder(orderId);
    if (order.status !== "created") {
      throw new Error(`Cannot pay order ${orderId} in status ${order.status}`);
    }
    const txHash = `0xmock-pay-${randomUUID()}`;
    order.status = "paid";
    order.paidAt = now();
    order.updatedTime = now();
    order.payTxHash = txHash;
    this.emit(EventType.OrderPaid, { order_id: orderId }, order.requesterAgentId, order.providerAgentId);
    return { order, txHash };
  }

  deliverOrder(orderId: string, req: DeliverOrderRequest): { order: Order; delivery: Delivery; txHash: string } {
    const order = this.mustGetOrder(orderId);
    if (order.status !== "paid") {
      throw new Error(`Cannot deliver order ${orderId} in status ${order.status}`);
    }
    const txHash = `0xmock-deliver-${randomUUID()}`;
    order.status = "completed";
    order.deliveredAt = now();
    order.updatedTime = now();
    order.deliverTxHash = txHash;

    const delivery: Delivery = {
      deliveryId: randomUUID(),
      orderId,
      providerAgentId: order.providerAgentId,
      deliverableType: req.deliverableType,
      deliverableSchema: req.deliverableSchema ?? "",
      deliverableText: req.deliverableText ?? "",
      contentHash: `0xmock-hash-${randomUUID()}`,
      status: "accepted",
      submittedAt: now(),
      verifiedAt: now(),
      createdTime: now(),
      updatedTime: now()
    };
    this.deliveries.set(orderId, delivery);
    this.emit(EventType.OrderCompleted, { order_id: orderId }, order.requesterAgentId, order.providerAgentId);
    return { order, delivery, txHash };
  }

  rejectOrder(orderId: string, reason: string) {
    const order = this.mustGetOrder(orderId);
    order.status = "rejected";
    order.rejectReason = reason;
    order.rejectedAt = now();
    order.updatedTime = now();
    this.emit(EventType.OrderRejected, { order_id: orderId, reason }, order.requesterAgentId, order.providerAgentId);
  }

  expireOrder(orderId: string) {
    const order = this.mustGetOrder(orderId);
    order.status = "expired";
    order.expiredAt = now();
    order.updatedTime = now();
    this.emit(EventType.OrderExpired, { order_id: orderId }, order.requesterAgentId, order.providerAgentId);
  }

  getDelivery(orderId: string): Delivery {
    const delivery = this.deliveries.get(orderId);
    if (!delivery) throw new Error(`No delivery for order ${orderId}`);
    return delivery;
  }

  on(agentId: string, type: string, handler: (event: CapEvent) => void): () => void {
    const key = `${agentId}:${type}`;
    this.bus.on(key, handler);
    return () => this.bus.off(key, handler);
  }

  private emit(type: string, payload: Omit<CapEvent, "type" | "raw">, ...agentIds: string[]) {
    const event: CapEvent = { type, raw: {}, ...payload };
    for (const agentId of new Set(agentIds)) {
      this.bus.emit(`${agentId}:${type}`, event);
    }
  }

  private mustGetNegotiation(id: string): Negotiation {
    const n = this.negotiations.get(id);
    if (!n) throw new Error(`Unknown negotiationId: ${id}`);
    return n;
  }

  private mustGetOrder(id: string): Order {
    const o = this.orders.get(id);
    if (!o) throw new Error(`Unknown orderId: ${id}`);
    return o;
  }

  private mustGetService(id: string): ServiceListing {
    const s = this.services.get(id);
    if (!s) throw new Error(`Unknown serviceId: ${id}`);
    return s;
  }
}

/** One shared network per process -- stands in for the CROO backend all agents talk to. */
export const mockCapNetwork = new MockCapNetwork();
