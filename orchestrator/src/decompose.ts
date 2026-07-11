/**
 * Goal decomposition layer. Deliberately simple (per the brief): a flat list
 * of 2-4 subtasks with only enough dependency info to sequence them, not a
 * true DAG scheduler. Each subtask names a required `capability` -- a short
 * tag the discovery layer (registry.ts) matches against registered
 * specialists' tags.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

export interface Subtask {
  id: string;
  capability: string;
  instructions: string;
  dependsOn: string[];
}

const SUBTASK_SCHEMA = {
  type: "object",
  properties: {
    subtasks: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "short unique slug, e.g. 'research-1'" },
          capability: {
            type: "string",
            description:
              "the single capability tag needed to do this subtask (e.g. 'research', 'verify', 'content'); prefer these three when the goal fits them"
          },
          instructions: {
            type: "string",
            description: "specific, self-contained instructions for the specialist agent doing this subtask"
          },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description: "ids of subtasks that must complete before this one starts; [] if none"
          }
        },
        required: ["id", "capability", "instructions", "dependsOn"],
        additionalProperties: false
      }
    }
  },
  required: ["subtasks"],
  additionalProperties: false
} as const;

const SYSTEM_PROMPT = `You are the planning layer of a multi-agent orchestrator. Given a \
high-level goal in natural language, break it into a flat list of 2-4 subtasks that, done \
in order, accomplish the goal. This is a v1 system: do not build a complex task graph, just \
a short ordered list with simple dependsOn references for sequencing (e.g. a "write" \
subtask depends on the "research" subtask that feeds it). The specialist agents available \
by default are tagged 'research' (topic -> summarized brief with sources), 'verify' \
(claim/output -> confidence score + flags), and 'content' (brief -> formatted output like a \
thread or doc). Prefer composing subtasks from these three capabilities when the goal fits; \
only name a different capability tag if the goal genuinely needs something else.`;

export async function decomposeGoal(goal: string): Promise<Subtask[]> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: SUBTASK_SCHEMA }
    },
    messages: [{ role: "user", content: `Goal: "${goal}"\n\nDecompose this into subtasks.` }]
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Planner declined to decompose this goal (safety refusal)");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  if (!textBlock) {
    throw new Error(`No decomposition in planner response (stop_reason=${response.stop_reason})`);
  }

  const parsed = JSON.parse(textBlock.text) as { subtasks: Subtask[] };
  return parsed.subtasks;
}
