#!/usr/bin/env node
import { config } from "./config.js";
import { runGoal } from "./orchestrate.js";
import { formatReceiptTrail } from "./compose.js";
import { startAllSpecialists } from "./specialists/runAll.js";

const DEFAULT_GOAL =
  "Research the current state of AI agent-to-agent payment protocols, verify the key claims, and write a short Twitter thread announcing it.";

async function main() {
  const goal = process.argv.slice(2).join(" ").trim() || DEFAULT_GOAL;

  console.log(`Multi-Agent Orchestrator (CAP_MODE=${config.capMode})`);
  console.log(`Goal: ${goal}\n`);

  let stopSpecialists: (() => void) | null = null;
  if (config.capMode === "mock") {
    console.log("Starting the 3 specialist agents in-process (mock CAP network)...\n");
    stopSpecialists = await startAllSpecialists((msg) => console.log(`  ${msg}`));
  }

  try {
    const report = await runGoal(goal, (msg) => console.log(msg));

    console.log("\n" + "=".repeat(72));
    console.log(`STATUS: ${report.status.toUpperCase()}`);
    console.log("=".repeat(72));
    console.log("\n--- Composed Result ---\n");
    console.log(report.composedResult);
    console.log("\n--- Receipts ---\n");
    console.log(formatReceiptTrail(report));
    console.log(`\nStarted:   ${report.startedAt}`);
    console.log(`Completed: ${report.completedAt}`);

    process.exitCode = report.status === "failure" ? 1 : 0;
  } finally {
    stopSpecialists?.();
  }
}

main().catch((err) => {
  console.error("Orchestrator run failed:", err);
  process.exitCode = 1;
});
