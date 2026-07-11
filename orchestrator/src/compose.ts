/**
 * Composition + delivery layer: merges specialist outputs into one coherent
 * result and attaches the full on-chain receipt trail (order ids, tx
 * hashes, amounts, which agent did what) rather than silently dropping
 * failed subtasks.
 */
import type { Subtask } from "./decompose.js";
import type { SubtaskReceipt } from "./hire.js";

export type RunStatus = "success" | "partial_failure" | "failure";

export interface OrchestrationReport {
  goal: string;
  status: RunStatus;
  composedResult: string;
  subtasks: Subtask[];
  receipts: SubtaskReceipt[];
  totalPaidUsdc: number;
  startedAt: string;
  completedAt: string;
}

export function composeResult(
  goal: string,
  subtasks: Subtask[],
  receipts: SubtaskReceipt[],
  startedAt: string
): OrchestrationReport {
  const completed = receipts.filter((r) => r.status === "completed");
  const failed = receipts.filter((r) => r.status === "failed");
  const status: RunStatus = failed.length === 0 ? "success" : completed.length === 0 ? "failure" : "partial_failure";

  // Terminal subtasks = nothing else depends on them = the end of each chain.
  const dependedOn = new Set(subtasks.flatMap((s) => s.dependsOn));
  const terminalIds = new Set(subtasks.filter((s) => !dependedOn.has(s.id)).map((s) => s.id));
  const terminalReceipts = receipts.filter((r) => terminalIds.has(r.subtaskId) && r.status === "completed");

  const primary = terminalReceipts
    .map((r) => r.output?.text ?? JSON.stringify(r.output?.schema, null, 2))
    .join("\n\n---\n\n");

  const totalPaidUsdc = completed.reduce((sum, r) => sum + (r.amountPaid ?? 0), 0);

  const failureNotes = failed.map((r) => `- ${r.subtaskId} (${r.capability}): ${r.failureReason}`).join("\n");

  const composedResult =
    status === "failure"
      ? `Could not complete "${goal}" -- every subtask failed.\n\n${failureNotes}`
      : [
          primary || "(no terminal output produced)",
          failed.length ? `\n\n⚠ Partial failure -- ${failed.length} subtask(s) did not complete:\n${failureNotes}` : ""
        ].join("");

  return {
    goal,
    status,
    composedResult,
    subtasks,
    receipts,
    totalPaidUsdc,
    startedAt,
    completedAt: new Date().toISOString()
  };
}

export function formatReceiptTrail(report: OrchestrationReport): string {
  const lines: string[] = [];
  lines.push(`Receipt trail (${report.receipts.length} subtask(s), $${report.totalPaidUsdc.toFixed(2)} USDC paid):`);
  for (const r of report.receipts) {
    lines.push(`\n[${r.subtaskId}] capability="${r.capability}" -> ${r.status.toUpperCase()}`);
    for (const a of r.attempts) {
      const parts = [`agent=${a.agentId}`, `service=${a.serviceId}`, `outcome=${a.outcome}`];
      if (a.orderId) parts.push(`orderId=${a.orderId}`);
      if (a.payTxHash) parts.push(`payTx=${a.payTxHash}`);
      if (a.deliverTxHash) parts.push(`deliverTx=${a.deliverTxHash}`);
      if (a.outcome === "delivered") parts.push(`paid=$${a.price} USDC`);
      if (a.detail) parts.push(`detail="${a.detail}"`);
      lines.push(`  - ${parts.join(" ")}`);
    }
  }
  return lines.join("\n");
}
