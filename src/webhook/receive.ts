import { messageExists, saveMessage } from "../db/messages.js";
import { markReadAndShowTyping, sendText } from "../whatsapp/client.js";
import { downloadAndStoreMedia } from "../whatsapp/media.js";
import { scheduleAgentTurn } from "../agent/scheduler.js";
import { upsertConversation, isBotPaused } from "../db/conversations.js";
import { checkTextHardTriggers, isLikelyIdentityDocumentImage } from "../guardrails/hardTriggers.js";
import { escalate } from "../escalation/escalate.js";
import { loadOperatorConfig } from "../escalation/operatorConfig.js";
import { handleOperatorCommand } from "../escalation/operatorCommands.js";
import type { WhatsAppInboundMessage, WhatsAppWebhookBody } from "../whatsapp/types.js";

const HARD_TRIGGER_ACK =
  "Thanks for reaching out — I've flagged this for our team, someone will follow up with you shortly!";

/**
 * Phase 4 adds, ahead of the normal agent hand-off: operator command
 * detection (the alert thread's "resume"/"take" replies), the bot_paused
 * gate (a paused conversation is logged, never scheduled), and hard
 * escalation triggers that bypass the model entirely (identity-document
 * images, and text matching config/escalation-rules.json's keyword
 * lists). Everything else — dedupe, persistence, media download — is
 * unchanged from Phase 2/3.
 *
 * Called fire-and-forget from the webhook route AFTER it has already
 * responded 200 to Meta — see server.ts. Errors here are logged, not
 * thrown back at a caller that has already moved on.
 */
export async function processWebhookBody(body: WhatsAppWebhookBody): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const { value } = change;
      const ourNumber = value.metadata?.phone_number_id;

      for (const message of value.messages ?? []) {
        await handleInboundMessage(message, ourNumber, value.contacts);
      }
      // value.statuses (delivery/read receipts for our own outbound sends)
      // are intentionally not persisted — nothing downstream needs them yet.
    }
  }
}

async function handleInboundMessage(
  message: WhatsAppInboundMessage,
  ourPhoneNumberId: string,
  contacts: Array<{ profile: { name?: string }; wa_id: string }> | undefined,
): Promise<void> {
  const already = await messageExists(message.id);
  if (already) {
    console.log(`[dedupe] skipping already-processed message ${message.id} (Meta webhook retry)`);
    return;
  }

  const waTimestamp = new Date(parseInt(message.timestamp, 10) * 1000).toISOString();
  let textBody: string | null = null;
  let mediaId: string | null = null;
  let mediaStoragePath: string | null = null;
  let messageType: "text" | "image" | "document" | "audio" | "video" | "other" = "other";
  let mediaRedacted = false;
  let mediaFlaggedReason: string | null = null;

  if (message.type === "text") {
    messageType = "text";
    textBody = message.text?.body ?? null;
  } else if (message.type === "image" || message.type === "document" || message.type === "audio" || message.type === "video") {
    messageType = message.type;
    const mediaRef = message[message.type];
    mediaId = mediaRef?.id ?? null;

    if (isLikelyIdentityDocumentImage(messageType)) {
      // Flag, don't process further — never pass this to the model. Still
      // downloaded/stored (the agency may legitimately need the document
      // for the actual work-permit application), but flagged so nothing
      // downstream treats it as ordinary media. See hardTriggers.ts for
      // why this is scoped to images only, not documents.
      mediaRedacted = true;
      mediaFlaggedReason = "inbound image — treated as a possible identity document, never forwarded to the model";
    }
    if (mediaId) {
      mediaStoragePath = await downloadAndStoreMedia(mediaId, message.id);
    }
  }

  await saveMessage({
    wa_message_id: message.id,
    direction: "inbound",
    wa_from: message.from,
    wa_to: ourPhoneNumberId,
    conversation_id: message.from,
    message_type: messageType,
    text_body: textBody,
    media_id: mediaId,
    media_storage_path: mediaStoragePath,
    media_redacted: mediaRedacted,
    media_flagged_reason: mediaFlaggedReason,
    wa_timestamp: waTimestamp,
    raw_payload: message,
  });

  const profileName = contacts?.find((c) => c.wa_id === message.from)?.profile?.name;
  if (profileName) {
    await upsertConversation(message.from, { enquirer_name: profileName });
  }

  await markReadAndShowTyping(message.id);

  const operatorConfig = await loadOperatorConfig();
  if (message.from === operatorConfig.operator_whatsapp_number) {
    await handleOperatorCommand(textBody, operatorConfig.operator_whatsapp_number);
    return;
  }

  if (await isBotPaused(message.from)) {
    console.log(`[paused] conversation ${message.from} is paused — logged, not scheduling the agent`);
    return;
  }

  if (mediaRedacted) {
    await escalate({
      conversationId: message.from,
      reason: "Enquirer sent an image, treated as a possible identity document (passport/NRIC)",
      urgency: "high",
    });
    await sendAckAndPersist(message.from, ourPhoneNumberId);
    return;
  }

  if (textBody) {
    const trigger = await checkTextHardTriggers(textBody);
    if (trigger) {
      await escalate({ conversationId: message.from, reason: trigger.reason, urgency: trigger.urgency });
      await sendAckAndPersist(message.from, ourPhoneNumberId);
      return;
    }
  }

  scheduleAgentTurn(message.from, ourPhoneNumberId);
}

async function sendAckAndPersist(conversationId: string, ourPhoneNumberId: string): Promise<void> {
  const { id: outboundId } = await sendText(conversationId, HARD_TRIGGER_ACK);
  await saveMessage({
    wa_message_id: outboundId,
    direction: "outbound",
    wa_from: ourPhoneNumberId,
    wa_to: conversationId,
    conversation_id: conversationId,
    message_type: "text",
    text_body: HARD_TRIGGER_ACK,
    wa_timestamp: new Date().toISOString(),
    raw_payload: { hard_trigger_ack: true },
  });
}
