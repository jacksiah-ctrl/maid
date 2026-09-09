import { getRecentMessages } from "../db/messages.js";
import { getNoProgressThreshold } from "./hardTriggers.js";

/**
 * "Three consecutive turns without progress" — if the last N outbound
 * (bot) replies in a row made zero tool calls, the conversation is
 * probably stuck (the model just chatting without doing anything
 * actionable), so escalate rather than let it spin further. Threshold is
 * config/escalation-rules.json's no_progress_turn_threshold.
 */
export async function isStuckWithNoProgress(conversationId: string): Promise<boolean> {
  const threshold = await getNoProgressThreshold();
  // Fetch generously more than the threshold since getRecentMessages
  // returns both directions — we need the last `threshold` OUTBOUND rows.
  const recent = await getRecentMessages(conversationId, threshold * 4 + 5);
  const outbound = recent.filter((m) => m.direction === "outbound").slice(-threshold);

  if (outbound.length < threshold) return false; // not enough history yet

  return outbound.every((m) => {
    const toolCalls = (m.raw_payload as { tool_calls?: unknown[] } | undefined)?.tool_calls;
    return !toolCalls || toolCalls.length === 0;
  });
}
