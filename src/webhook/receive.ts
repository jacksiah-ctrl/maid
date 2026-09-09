import { messageExists, saveMessage } from "../db/messages.js";
import { markReadAndShowTyping } from "../whatsapp/client.js";
import { downloadAndStoreMedia } from "../whatsapp/media.js";
import { scheduleAgentTurn } from "../agent/scheduler.js";
import type { WhatsAppInboundMessage, WhatsAppWebhookBody } from "../whatsapp/types.js";

/**
 * Phase 3: persist + debounce + hand off to the agent loop (scheduler.ts),
 * instead of Phase 2's immediate echo. A burst of rapid-fire messages each
 * lands here, gets persisted and marked read individually, and each one
 * resets the same 4s debounce timer — the agent only actually runs once,
 * 4s after the last message in the burst, reading the whole coalesced
 * history back from the messages table.
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
      // are intentionally not persisted — nothing downstream needs them yet.
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
    // NOTE: identity-document detection/redaction/auto-escalation for
    // images is explicitly Phase 4 scope (the brief's hard escalation
    // triggers). For now every image/document is persisted and handed to
    // the model as "[sent a document]" like any other turn — it is NOT
    // yet routed away from the model, and nothing redacts it. Don't rely
    // on this build for anything involving real ID photos.
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
  scheduleAgentTurn(message.from, ourPhoneNumberId);
}
