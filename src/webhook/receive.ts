import { messageExists, saveMessage } from "../db/messages.js";
import { sendText, markReadAndShowTyping } from "../whatsapp/client.js";
import { downloadAndStoreMedia } from "../whatsapp/media.js";
import type { WhatsAppInboundMessage, WhatsAppWebhookBody } from "../whatsapp/types.js";

/**
 * Phase 2 scope: an echo bot. Text in, same text back out. Non-text
 * messages are downloaded/stored/persisted (proving the media pipeline)
 * and get a short acknowledgment reply rather than an actual echo — the
 * real agent loop replaces this whole function in Phase 3.
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
        await handleInboundMessage(message, ourNumber);
      }
      // value.statuses (delivery/read receipts for our own outbound sends)
      // are intentionally not persisted in Phase 2 — nothing downstream
      // needs them yet, and logging every status update is just noise.
    }
  }
}

async function handleInboundMessage(message: WhatsAppInboundMessage, ourPhoneNumberId: string): Promise<void> {
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

  if (message.type === "text") {
    messageType = "text";
    textBody = message.text?.body ?? null;
  } else if (message.type === "image" || message.type === "document" || message.type === "audio" || message.type === "video") {
    messageType = message.type;
    const mediaRef = message[message.type];
    mediaId = mediaRef?.id ?? null;
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
    wa_timestamp: waTimestamp,
    raw_payload: message,
  });

  await markReadAndShowTyping(message.id);

  const replyText = buildEchoReply(messageType, textBody);
  const { id: outboundId } = await sendText(message.from, replyText);

  await saveMessage({
    wa_message_id: outboundId,
    direction: "outbound",
    wa_from: ourPhoneNumberId,
    wa_to: message.from,
    conversation_id: message.from,
    message_type: "text",
    text_body: replyText,
    wa_timestamp: new Date().toISOString(),
    raw_payload: { echoed_from: message.id },
  });
}

function buildEchoReply(messageType: string, textBody: string | null): string {
  if (messageType === "text") {
    return textBody ?? "(empty message)";
  }
  return `Got your ${messageType} — thanks! (this is the Phase 2 echo bot; real handling for ${messageType}s lands in Phase 3)`;
}
