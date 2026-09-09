/**
 * CLI equivalent of the operator's WhatsApp "resume <number>" / "take
 * <number>" replies (src/escalation/operatorCommands.ts) — for when it's
 * easier to run a command than to find the alert thread.
 *
 * Usage:
 *   npm run toggle-pause -- resume 6591234567
 *   npm run toggle-pause -- take 6591234567
 *   npm run toggle-pause -- status 6591234567
 */
import { setBotPaused, getConversation } from "../src/db/conversations.js";

async function main() {
  const [command, rawNumber] = process.argv.slice(2);
  if (!command || !rawNumber || !["resume", "take", "status"].includes(command)) {
    console.error("Usage: npm run toggle-pause -- <resume|take|status> <conversation_id>");
    process.exit(1);
  }
  const conversationId = rawNumber.replace(/[^\d]/g, "");

  if (command === "status") {
    const row = await getConversation(conversationId);
    console.log(row ?? `No conversation record found for ${conversationId} (never messaged, or dry-run store was reset).`);
    return;
  }

  if (command === "resume") {
    await setBotPaused(conversationId, false, null);
    console.log(`Resumed conversation ${conversationId} — bot will respond to new messages again.`);
  } else {
    await setBotPaused(conversationId, true, "operator explicitly took over via CLI 'take' command");
    console.log(`Conversation ${conversationId} kept paused.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
