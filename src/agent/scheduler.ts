import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConversationHistory } from "./history.js";
import { runAgentTurn } from "./loop.js";
import { sendText } from "../whatsapp/client.js";
import { saveMessage } from "../db/messages.js";
import { isBotPaused } from "../db/conversations.js";
import { checkOutboundReply } from "../guardrails/preSend.js";
import { isStuckWithNoProgress } from "../guardrails/noProgress.js";
import { escalate } from "../escalation/escalate.js";

const NO_PROGRESS_FALLBACK_REPLY = "Sorry, let me get one of our team to help with this — they'll follow up with you shortly!";
const BLOCKED_REPLY_FALLBACK = "Let me check that properly and get back to you — connecting you with our team now.";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system-prompt.md");

const DEBOUNCE_MS = 4000;
const RETRY_IF_BUSY_MS = 500;

let cachedSystemPrompt: string | null = null;
async function getSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = await readFile(SYSTEM_PROMPT_PATH, "utf-8");
  return cachedSystemPrompt;
}

// In-memory only — debounce state and the "currently processing" lock live
// in this process's memory, not the database. Fine for a single-process
// prototype; a restart mid-debounce just means the pending burst gets
// picked up as history on the next inbound message instead of firing on
// its own. Documented as a known limitation, not silently assumed away.
const pendingTimers = new Map<string, NodeJS.Timeout>();
const processingLocks = new Set<string>();

/**
 * Call once per inbound message. Resets a per-conversation 4s timer, so a
 * burst of rapid-fire messages collapses into one agent turn fired 4s
 * after the LAST message in the burst — the debounce the brief asks for.
 */
export function scheduleAgentTurn(conversationId: string, ourPhoneNumberId: string): void {
  const existing = pendingTimers.get(conversationId);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    conversationId,
    setTimeout(() => void runWhenFree(conversationId, ourPhoneNumberId), DEBOUNCE_MS),
  );
}

async function runWhenFree(conversationId: string, ourPhoneNumberId: string): Promise<void> {
  if (processingLocks.has(conversationId)) {
    // A previous turn for this conversation is still running (unusual —
    // the model call would have to outlast the 4s debounce window). Don't
    // start a second, overlapping turn that could send two interleaved
    // replies; just check back shortly.
    pendingTimers.set(
      conversationId,
      setTimeout(() => void runWhenFree(conversationId, ourPhoneNumberId), RETRY_IF_BUSY_MS),
    );
    return;
  }
  pendingTimers.delete(conversationId);
  processingLocks.add(conversationId);
  try {
    await runConversationTurn(conversationId, ourPhoneNumberId);
  } catch (err) {
    console.error(`[agent] turn failed for conversation ${conversationId}:`, err);
  } finally {
    processingLocks.delete(conversationId);
  }
}

async function runConversationTurn(conversationId: string, ourPhoneNumberId: string): Promise<void> {
  // Authoritative bot_paused check, right before the model call — a hard
  // trigger elsewhere may have paused this conversation AFTER it was
  // scheduled but before the debounce timer fired (see receive.ts, which
  // also checks this as a cheaper up-front skip; this is the check that
  // actually matters).
  if (await isBotPaused(conversationId)) {
    console.log(`[paused] conversation ${conversationId} is paused — skipping the scheduled agent turn`);
    return;
  }

  const [systemPrompt, history] = await Promise.all([
    getSystemPrompt(),
    loadConversationHistory(conversationId),
  ]);

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    // Nothing new to respond to (e.g. the debounce fired after the
    // conversation was already answered by a faster-firing retry).
    return;
  }

  // Hard trigger: three consecutive bot turns with zero tool calls means
  // the conversation is stuck. Fires regardless of what the model would
  // say next — don't even call it.
  if (await isStuckWithNoProgress(conversationId)) {
    console.log(`[agent] conversation ${conversationId} stuck with no progress — escalating instead of calling the model`);
    await escalate({ conversationId, reason: "Three consecutive replies made no progress (no tool calls)", urgency: "medium" });
    await sendReply(conversationId, ourPhoneNumberId, NO_PROGRESS_FALLBACK_REPLY, []);
    return;
  }

  const { replyText, toolCallLog } = await runAgentTurn(systemPrompt, history, { conversationId });
  console.log(`[agent] conversation=${conversationId} tool_calls=${toolCallLog.length} reply="${replyText}"`);

  const preSend = checkOutboundReply(replyText, toolCallLog);
  if (preSend.blocked) {
    console.error(`[guardrail] blocked outbound reply for conversation ${conversationId}: ${preSend.reason}. Draft was: "${replyText}"`);
    await escalate({
      conversationId,
      reason: `Pre-send guardrail blocked a draft reply: ${preSend.reason}`,
      urgency: "high",
    });
    await sendReply(conversationId, ourPhoneNumberId, BLOCKED_REPLY_FALLBACK, toolCallLog);
    return;
  }

  await sendReply(conversationId, ourPhoneNumberId, replyText, toolCallLog);
}

async function sendReply(
  conversationId: string,
  ourPhoneNumberId: string,
  replyText: string,
  toolCallLog: Array<{ name: string; input: unknown }>,
): Promise<void> {
  const { id: outboundId } = await sendText(conversationId, replyText);
  await saveMessage({
    wa_message_id: outboundId,
    direction: "outbound",
    wa_from: ourPhoneNumberId,
    wa_to: conversationId,
    conversation_id: conversationId,
    message_type: "text",
    text_body: replyText,
    wa_timestamp: new Date().toISOString(),
    raw_payload: { tool_calls: toolCallLog.map((t) => ({ name: t.name, input: t.input })) },
  });
}
