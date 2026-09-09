import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool, type ToolContext } from "./tools/index.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
// Chat + tool-use for a support bot is not the hard-reasoning end of the
// spectrum the "high"+ effort levels are tuned for — start at "medium" and
// re-measure against the Phase 5 eval before raising or lowering it.
const EFFORT = (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | "xhigh" | "max") || "medium";
const MAX_TOKENS = 2048; // WhatsApp replies should be short; also bounds cost per turn
const MAX_TOOL_ITERATIONS = 6; // safety valve against a runaway tool loop, not a normal path

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface AgentTurnResult {
  replyText: string;
  toolCallLog: Array<{ name: string; input: unknown; result: unknown }>;
  hitIterationCap: boolean;
}

/**
 * Runs the manual tool-use loop to completion (or until MAX_TOOL_ITERATIONS)
 * and returns the final assistant text. A manual loop rather than the SDK's
 * (beta) tool runner because Phase 4's guardrails need to see and gate
 * every tool call and every candidate reply before it goes out — the
 * runner's per-turn hooks could do this too, but owning the loop directly
 * keeps that logic in one obvious place for a prototype this size.
 */
export async function runAgentTurn(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  ctx: ToolContext,
): Promise<AgentTurnResult> {
  const toolCallLog: Array<{ name: string; input: unknown; result: unknown }> = [];
  const working = [...messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await callWithErrorHandling(systemPrompt, working);

    if (response.stop_reason === "pause_turn") {
      working.push({ role: "assistant", content: response.content });
      continue;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      const text = extractText(response.content);
      return { replyText: text, toolCallLog, hitIterationCap: false };
    }

    working.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      let result: unknown;
      try {
        result = await executeTool(block.name, block.input as Record<string, unknown>, ctx);
      } catch (err) {
        result = { error: (err as Error).message };
      }
      toolCallLog.push({ name: block.name, input: block.input, result });
      console.log(`[agent tool] ${block.name}(${JSON.stringify(block.input)}) ->`, JSON.stringify(result));
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    working.push({ role: "user", content: toolResults });
  }

  // Hit the iteration cap without reaching end_turn — this should be rare
  // (six tool round-trips is generous for this tool set). Fail toward a
  // human rather than an infinite loop or a made-up answer.
  console.error(`[agent] hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) for conversation ${ctx.conversationId}`);
  return {
    replyText: "Sorry, let me get one of our team to help with this — they'll follow up with you shortly!",
    toolCallLog,
    hitIterationCap: true,
  };
}

async function callWithErrorHandling(systemPrompt: string, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
  try {
    return await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: toolDefinitions,
      output_config: { effort: EFFORT },
      messages,
    });
  } catch (err) {
    // Most-specific-first, per the SDK's typed exception chain — never
    // string-match error messages.
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error(`Anthropic API rate limited: ${err.message}`);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error(`Anthropic API authentication failed — check ANTHROPIC_API_KEY: ${err.message}`);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new Error(`Anthropic API connection error: ${err.message}`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error (${err.status}): ${err.message}`);
    }
    throw err;
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
