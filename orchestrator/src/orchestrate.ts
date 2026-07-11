import { decomposeGoal, type Subtask } from "./decompose.js";
import { hireForSubtask, type SubtaskReceipt } from "./hire.js";
import { createCapClient } from "./cap/index.js";
import { composeResult, type OrchestrationReport } from "./compose.js";

/**
 * Orders subtasks so every dependency runs before its dependents. Not a real
 * scheduler (per the brief, v1 doesn't need true DAG scheduling) -- just a
 * depth-first pass over a flat list, with a cycle guard so a malformed
 * dependsOn from the planner can't hang the run.
 */
function orderByDependency(subtasks: Subtask[]): Subtask[] {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const ordered: Subtask[] = [];
  const done = new Set<string>();

  function visit(subtask: Subtask, inStack: Set<string>) {
    if (done.has(subtask.id) || inStack.has(subtask.id)) return;
    inStack.add(subtask.id);
    for (const depId of subtask.dependsOn) {
      const dep = byId.get(depId);
      if (dep) visit(dep, inStack);
    }
    if (!done.has(subtask.id)) {
      ordered.push(subtask);
      done.add(subtask.id);
    }
  }

  for (const subtask of subtasks) visit(subtask, new Set());
  return ordered;
}

function withUpstreamContext(subtask: Subtask, outputsById: Map<string, SubtaskReceipt>): Subtask {
  const upstream = subtask.dependsOn
    .map((id) => outputsById.get(id))
    .filter((r): r is SubtaskReceipt => !!r && r.status === "completed");

  if (upstream.length === 0) return subtask;

  const context = upstream
    .map((r) => `[from ${r.subtaskId}]: ${r.output?.text ?? JSON.stringify(r.output?.schema)}`)
    .join("\n\n");

  return { ...subtask, instructions: `${subtask.instructions}\n\n--- Input from prior subtask(s) ---\n${context}` };
}

export async function runGoal(goal: string, log: (msg: string) => void = () => {}): Promise<OrchestrationReport> {
  const startedAt = new Date().toISOString();

  log(`Decomposing goal: "${goal}"`);
  const subtasks = await decomposeGoal(goal);
  log(`Decomposed into ${subtasks.length} subtask(s): ${subtasks.map((s) => `${s.id}[${s.capability}]`).join(", ")}`);

  const ordered = orderByDependency(subtasks);
  const client = createCapClient("agent-orchestrator", "ORCHESTRATOR");
  const receipts: SubtaskReceipt[] = [];
  const outputsById = new Map<string, SubtaskReceipt>();

  for (const subtask of ordered) {
    const enriched = withUpstreamContext(subtask, outputsById);
    log(`Hiring for subtask "${subtask.id}" (capability="${subtask.capability}")...`);

    const receipt = await hireForSubtask(client, enriched);
    receipts.push(receipt);
    outputsById.set(subtask.id, receipt);

    log(
      receipt.status === "completed"
        ? `Subtask "${subtask.id}" -> completed (hired ${receipt.agentId}, paid $${receipt.amountPaid} USDC)`
        : `Subtask "${subtask.id}" -> FAILED (${receipt.failureReason})`
    );
  }

  // Preserve the planner's original ordering in the report regardless of hiring order.
  const receiptsInPlanOrder = subtasks.map((s) => receipts.find((r) => r.subtaskId === s.id)!);
  return composeResult(goal, subtasks, receiptsInPlanOrder, startedAt);
}
