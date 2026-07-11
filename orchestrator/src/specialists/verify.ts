import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { WorkFn } from "./types.js";

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    confidenceScore: { type: "number", description: "0.0-1.0 confidence that the claim/output is accurate and internally consistent" },
    flags: { type: "array", items: { type: "string" }, description: "specific concerns found, e.g. unsupported claims, internal contradictions, vague hand-waving. [] if none." },
    reasoning: { type: "string", description: "brief justification for the score" }
  },
  required: ["confidenceScore", "flags", "reasoning"],
  additionalProperties: false
} as const;

const SYSTEM_PROMPT = `You are a verification specialist agent. Given a claim or another \
agent's output, assess its accuracy and internal consistency and return a confidence score \
plus any flags. You do not have live web access here, so judge based on internal \
consistency, specificity vs. vagueness, and general world knowledge -- say so in your \
reasoning when you can't fully verify a factual claim, and lower the score rather than \
guessing.`;

export const verifyWork: WorkFn = async (requirements) => {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: VERIFY_SCHEMA }
    },
    messages: [{ role: "user", content: `Claim/output to verify:\n\n${requirements}` }]
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  const parsed = textBlock ? JSON.parse(textBlock.text) : { confidenceScore: 0, flags: ["no response"], reasoning: "" };
  return { deliverableType: "schema", schema: parsed };
};
