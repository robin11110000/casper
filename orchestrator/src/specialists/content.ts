import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { WorkFn } from "./types.js";

const SYSTEM_PROMPT = `You are a content specialist agent. Given a brief (research notes, a \
summary, or raw material) and formatting instructions, produce polished, ready-to-publish \
output -- a thread, a doc, a post, whatever the instructions call for. Return plain text \
(markdown formatting is fine), nothing else -- no preamble like "Here is the content".`;

export const contentWork: WorkFn = async (requirements) => {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: requirements }]
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return { deliverableType: "text", text: textBlock?.text ?? "" };
};
