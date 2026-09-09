import { setBotPaused } from "../db/conversations.js";
import { sendText } from "../whatsapp/client.js";

const COMMAND_RE = /^\s*(resume|take)\s+(\+?\d[\d\s-]{4,})\s*$/i;

function normalizeNumber(raw: string): string {
  return raw.replace(/[^\d]/g, ""); // WhatsApp ids are digits-only, no '+'
}

/**
 * Parses and executes an operator's reply in the alert thread: "resume
 * <number>" unpauses a conversation, "take <number>" explicitly keeps it
 * paused (a no-op on the pause state itself, since escalating already
 * paused it — this exists so the operator has a clear way to acknowledge
 * "I've got this" without accidentally resuming the bot). Unrecognized
 * text from the operator number is ignored, not an error — the operator's
 * thread isn't required to only ever contain commands.
 *
 * Same logic as scripts/toggle-pause.ts (the CLI equivalent) — this is
 * the WhatsApp-reply path specifically.
 */
export async function handleOperatorCommand(text: string | null, operatorNumber: string): Promise<void> {
  if (!text) return;
  const match = text.match(COMMAND_RE);
  if (!match) {
    console.log(`[operator] message from operator didn't match a command, ignoring: "${text}"`);
    return;
  }

  const command = match[1].toLowerCase();
  const conversationId = normalizeNumber(match[2]);

  if (command === "resume") {
    await setBotPaused(conversationId, false, null);
    console.log(`[operator] resumed conversation ${conversationId}`);
    await sendText(operatorNumber, `Resumed — bot is handling ${conversationId} again.`);
  } else {
    await setBotPaused(conversationId, true, "operator explicitly took over via 'take' command");
    console.log(`[operator] conversation ${conversationId} explicitly kept paused ('take')`);
    await sendText(operatorNumber, `Noted — keeping ${conversationId} paused, it's yours.`);
  }
}
