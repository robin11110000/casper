/**
 * Claude-powered claim evaluation: given a disputed assertion's claim text, the
 * arbiter researches it (web search) and returns a structured verdict. This is the
 * "AI committee member" -- its vote is submitted on-chain by `castVote` in
 * `casperVote.ts`, exactly like the other (human) committee members' votes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

export interface Verdict {
  outcome: boolean;
  confidence: number;
  reasoning: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    outcome: {
      type: "boolean",
      description: "true if the claim holds / is accurate, false if it does not"
    },
    confidence: {
      type: "number",
      description: "0.0-1.0 confidence in the outcome"
    },
    reasoning: {
      type: "string",
      description: "Brief justification citing the evidence found"
    }
  },
  required: ["outcome", "confidence", "reasoning"],
  additionalProperties: false
} as const;

const SYSTEM_PROMPT = `You are an impartial arbitrator for an on-chain optimistic oracle. \
A claim has been asserted and disputed; two parties have posted bonds on opposite sides. \
Your job is to determine, as best you can from available evidence, whether the claim is \
true or false. Use web search for anything time-sensitive or checkable (scores, prices, \
events, statistics). If the claim cannot be verified either way, say so plainly in your \
reasoning and give a low confidence score rather than guessing.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

/**
 * Evaluates a disputed claim and returns a verdict. Not exercised against a live
 * Anthropic API key in this session (see README) -- the request shape follows the
 * current Messages API (Claude Opus 4.8, adaptive thinking, web_search tool,
 * structured JSON output), but has not been run end to end here.
 */
export async function evaluateClaim(claim: string): Promise<Verdict> {
  const anthropic = getClient();

  let response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20260209", name: "web_search" }],
    output_config: {
      format: { type: "json_schema", schema: VERDICT_SCHEMA }
    },
    messages: [
      {
        role: "user",
        content: `Claim under dispute: "${claim}"\n\nInvestigate and return your verdict.`
      }
    ]
  });

  // Server-side tools (web_search) can hit their internal iteration cap and return
  // pause_turn; resending the same history lets the server resume automatically.
  let continuations = 0;
  while (response.stop_reason === "pause_turn" && continuations < 3) {
    response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      output_config: {
        format: { type: "json_schema", schema: VERDICT_SCHEMA }
      },
      messages: [
        {
          role: "user",
          content: `Claim under dispute: "${claim}"\n\nInvestigate and return your verdict.`
        },
        { role: "assistant", content: response.content }
      ]
    });
    continuations += 1;
  }

  if (response.stop_reason === "refusal") {
    throw new Error("Arbiter model declined to evaluate this claim (safety refusal)");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  if (!textBlock) {
    throw new Error(`No text verdict in model response (stop_reason=${response.stop_reason})`);
  }

  const parsed = JSON.parse(textBlock.text) as Verdict;
  return parsed;
}
