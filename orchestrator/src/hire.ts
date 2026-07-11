/**
 * Hiring + payment layer -- the actual CAP integration. For one subtask:
 * negotiateOrder -> (wait for provider to acceptNegotiation) -> payOrder ->
 * (wait for provider to deliverOrder) -> getDelivery. Settlement is
 * automatic (CAPVault releases escrow the instant the provider delivers),
 * so there is no separate "confirm" call.
 *
 * Also the failure-handling layer: every step is bounded by a timeout. A
 * specialist that never accepts, never delivers, or has its negotiation/order
 * rejected does not crash the run -- this hires the next-best candidate for
 * the same capability instead, up to `config.maxRetriesPerSubtask` retries,
 * and returns a `failed` receipt (with the full attempt history) rather than
 * throwing if every candidate strikes out.
 */
import { config } from "./config.js";
import { findCandidates } from "./registry.js";
import { sleep } from "./util.js";
import type { CapClient, Order, ServiceListing } from "./cap/types.js";
import type { Subtask } from "./decompose.js";

export type AttemptOutcome = "delivered" | "no_response" | "rejected" | "expired" | "error";

export interface Attempt {
  agentId: string;
  serviceId: string;
  price: number;
  negotiationId?: string;
  orderId?: string;
  payTxHash?: string;
  deliverTxHash?: string;
  outcome: AttemptOutcome;
  detail?: string;
  startedAt: string;
  endedAt: string;
}

export interface DeliveredOutput {
  deliverableType: "text" | "schema";
  text?: string;
  schema?: unknown;
}

export interface SubtaskReceipt {
  subtaskId: string;
  capability: string;
  status: "completed" | "failed";
  attempts: Attempt[];
  agentId?: string;
  serviceId?: string;
  amountPaid?: number;
  output?: DeliveredOutput;
  failureReason?: string;
}

async function waitUntil<T>(
  fn: () => Promise<T>,
  isReady: (value: T) => boolean,
  deadlineAt: number,
  intervalMs: number
): Promise<T | null> {
  for (;;) {
    const value = await fn();
    if (isReady(value)) return value;
    if (Date.now() >= deadlineAt) return null;
    await sleep(Math.min(intervalMs, Math.max(0, deadlineAt - Date.now())));
  }
}

async function attemptHire(client: CapClient, service: ServiceListing, requirements: string): Promise<Attempt> {
  const startedAt = new Date().toISOString();
  const deadlineAt = Date.now() + config.hireTimeoutMs;
  const attempt: Attempt = {
    agentId: service.agentId,
    serviceId: service.serviceId,
    price: service.price,
    outcome: "error",
    startedAt,
    endedAt: startedAt
  };

  try {
    const negotiation = await client.negotiateOrder({ serviceId: service.serviceId, requirements });
    attempt.negotiationId = negotiation.negotiationId;

    const settled = await waitUntil(
      () => client.getNegotiation(negotiation.negotiationId),
      (n) => n.status !== "pending",
      deadlineAt,
      config.pollIntervalMs
    );
    if (!settled) {
      attempt.outcome = "no_response";
      attempt.detail = `${service.agentId} did not respond to the negotiation within ${config.hireTimeoutMs}ms`;
      return finish(attempt);
    }
    if (settled.status === "rejected") {
      attempt.outcome = "rejected";
      attempt.detail = settled.rejectReason || "negotiation rejected";
      return finish(attempt);
    }
    if (settled.status === "expired") {
      attempt.outcome = "expired";
      attempt.detail = "negotiation expired";
      return finish(attempt);
    }

    // Negotiation carries no orderId -- find the order the provider's accept created.
    const order = await waitUntil(
      async () => (await client.listOrders({ role: "buyer" })).find((o) => o.negotiationId === negotiation.negotiationId) ?? null,
      (o): o is Order => o !== null,
      deadlineAt,
      config.pollIntervalMs
    );
    if (!order) {
      attempt.outcome = "no_response";
      attempt.detail = `negotiation accepted but no order appeared within ${config.hireTimeoutMs}ms`;
      return finish(attempt);
    }
    attempt.orderId = order.orderId;

    const { txHash: payTxHash } = await client.payOrder(order.orderId);
    attempt.payTxHash = payTxHash;

    const finalOrder = await waitUntil(
      () => client.getOrder(order.orderId),
      (o) => o.status === "completed" || o.status === "rejected" || o.status === "expired",
      deadlineAt,
      config.pollIntervalMs
    );
    if (!finalOrder) {
      attempt.outcome = "no_response";
      attempt.detail = `${service.agentId} did not deliver within ${config.hireTimeoutMs}ms after payment (escrow will auto-refund on SLA expiry)`;
      return finish(attempt);
    }
    if (finalOrder.status === "rejected") {
      attempt.outcome = "rejected";
      attempt.detail = finalOrder.rejectReason || "order rejected after payment (refunded)";
      return finish(attempt);
    }
    if (finalOrder.status === "expired") {
      attempt.outcome = "expired";
      attempt.detail = "order expired after payment (refunded)";
      return finish(attempt);
    }

    attempt.deliverTxHash = finalOrder.deliverTxHash || undefined;
    attempt.outcome = "delivered";
    return finish(attempt);
  } catch (err) {
    attempt.outcome = "error";
    attempt.detail = (err as Error).message;
    return finish(attempt);
  }
}

function finish(attempt: Attempt): Attempt {
  attempt.endedAt = new Date().toISOString();
  return attempt;
}

export async function hireForSubtask(client: CapClient, subtask: Subtask): Promise<SubtaskReceipt> {
  const candidates = findCandidates(subtask.capability);
  if (candidates.length === 0) {
    return {
      subtaskId: subtask.id,
      capability: subtask.capability,
      status: "failed",
      attempts: [],
      failureReason: `No registered agent found for capability "${subtask.capability}"`
    };
  }

  const attempts: Attempt[] = [];
  const maxAttempts = Math.min(candidates.length, 1 + config.maxRetriesPerSubtask);

  for (const service of candidates.slice(0, maxAttempts)) {
    const attempt = await attemptHire(client, service, subtask.instructions);
    attempts.push(attempt);

    if (attempt.outcome === "delivered" && attempt.orderId) {
      const delivery = await client.getDelivery(attempt.orderId);
      return {
        subtaskId: subtask.id,
        capability: subtask.capability,
        status: "completed",
        attempts,
        agentId: service.agentId,
        serviceId: service.serviceId,
        amountPaid: service.price,
        output: {
          deliverableType: delivery.deliverableType as "text" | "schema",
          text: delivery.deliverableText || undefined,
          schema: delivery.deliverableSchema ? safeJsonParse(delivery.deliverableSchema) : undefined
        }
      };
    }
  }

  return {
    subtaskId: subtask.id,
    capability: subtask.capability,
    status: "failed",
    attempts,
    failureReason: `All ${attempts.length} candidate(s) for "${subtask.capability}" failed: ${attempts
      .map((a) => `${a.agentId} (${a.outcome}${a.detail ? `: ${a.detail}` : ""})`)
      .join("; ")}`
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
