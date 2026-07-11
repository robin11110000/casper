import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { WorkFn } from "./types.js";

const SYSTEM_PROMPT = `You are a research specialist agent. Given a topic, produce a short, \
well-organized brief (a few paragraphs at most) with a "Sources" section listing the \
references you drew on (real, well-known sources by name -- you do not have live web \
access here, so do not invent specific URLs or fabricate quotes; cite general, \
well-established sources or say the brief is based on general knowledge if nothing \
specific applies). Return plain markdown text, nothing else.`;

export const researchWork: WorkFn = async (requirements) => {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Topic: ${requirements}` }]
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return { deliverableType: "text", text: textBlock?.text ?? "" };
};
