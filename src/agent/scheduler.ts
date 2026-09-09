import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConversationHistory } from "./history.js";
import { runAgentTurn } from "./loop.js";
import { sendText } from "../whatsapp/client.js";
import { saveMessage } from "../db/messages.js";

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
  const [systemPrompt, history] = await Promise.all([
    getSystemPrompt(),
    loadConversationHistory(conversationId),
  ]);

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    // Nothing new to respond to (e.g. the debounce fired after the
    // conversation was already answered by a faster-firing retry).
    return;
  }

  const { replyText, toolCallLog } = await runAgentTurn(systemPrompt, history, { conversationId });
  console.log(`[agent] conversation=${conversationId} tool_calls=${toolCallLog.length} reply="${replyText}"`);

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
