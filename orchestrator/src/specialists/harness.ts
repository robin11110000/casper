/**
 * Generic provider-side harness: wires a specialist's plain `WorkFn` to the
 * CAP order lifecycle (accept negotiation -> wait for payment -> deliver).
 * Identical code path for mock and real clients -- only the event source
 * differs (in-memory bus vs. real WebSocket), which is exactly the point of
 * the CapClient abstraction.
 */
import { EventType } from "@croo-network/sdk";
import type { CapClient, ServiceListing } from "../cap/types.js";
import type { WorkFn } from "./types.js";

const forcedFailOnce = new Set<string>(
  (process.env.FORCE_FAIL_AGENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

export interface ProviderHarness {
  stop(): void;
}

export async function runProviderHarness(
  capClient: CapClient,
  listing: ServiceListing,
  work: WorkFn,
  log: (msg: string) => void = () => {}
): Promise<ProviderHarness> {
  await capClient.registerService(listing);
  const stream = await capClient.connectWebSocket();
  const pendingRequirements = new Map<string, string>();

  stream.on(EventType.NegotiationCreated, async (event) => {
    if (!event.negotiation_id) return;
    try {
      const negotiation = await capClient.getNegotiation(event.negotiation_id);
      if (negotiation.serviceId !== listing.serviceId) return;

      if (forcedFailOnce.has(listing.agentId)) {
        forcedFailOnce.delete(listing.agentId);
        log(`[${listing.agentId}] simulating a non-responsive provider (FORCE_FAIL_AGENTS) -- ignoring negotiation ${event.negotiation_id}`);
        return;
      }

      const accepted = await capClient.acceptNegotiation(event.negotiation_id);
      pendingRequirements.set(accepted.order.orderId, negotiation.requirements);
      log(`[${listing.agentId}] accepted negotiation ${event.negotiation_id} -> order ${accepted.order.orderId}`);
    } catch (err) {
      log(`[${listing.agentId}] failed to accept negotiation ${event.negotiation_id}: ${(err as Error).message}`);
    }
  });

  stream.on(EventType.OrderPaid, async (event) => {
    if (!event.order_id) return;
    const requirements = pendingRequirements.get(event.order_id);
    if (requirements === undefined) return; // not our order
    try {
      const output = await work(requirements);
      await capClient.deliverOrder(event.order_id, {
        deliverableType: output.deliverableType,
        deliverableText: output.text,
        deliverableSchema: output.schema !== undefined ? JSON.stringify(output.schema) : undefined
      });
      log(`[${listing.agentId}] delivered order ${event.order_id}`);
    } catch (err) {
      log(`[${listing.agentId}] failed to deliver order ${event.order_id}: ${(err as Error).message}`);
    } finally {
      pendingRequirements.delete(event.order_id);
    }
  });

  return {
    stop: () => stream.close()
  };
}
