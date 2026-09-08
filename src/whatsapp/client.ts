import { config, hasWhatsAppCredentials } from "../config.js";

function graphUrl(pathSegment: string): string {
  return `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${pathSegment}`;
}

async function graphPost(pathSegment: string, body: unknown): Promise<unknown> {
  const res = await fetch(graphUrl(pathSegment), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`WhatsApp Graph API error (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Send a free-form text message. Only works within the 24h customer
 * service window (or ever, for the first message a user sends you) — see
 * README's note on the 24h window; template sends are a Phase 4 concern.
 *
 * Without WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID set, this logs
 * what it *would* send and returns a synthetic id, instead of throwing —
 * same dry-run posture as the rest of this project, so the webhook handler
 * and its tests work without live credentials.
 */
export async function sendText(to: string, body: string): Promise<{ id: string | null }> {
  if (!hasWhatsAppCredentials()) {
    console.log(`[dry-run] would send text to ${to}: ${JSON.stringify(body)}`);
    return { id: null };
  }
  const result = (await graphPost(`${config.whatsapp.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  })) as { messages?: Array<{ id: string }> };
  return { id: result.messages?.[0]?.id ?? null };
}

/**
 * Marks an inbound message read (blue ticks) and, in the same call, shows
 * the typing indicator until the next message is sent or ~25s elapses.
 * Best-effort: failures here should never block the actual reply.
 */
export async function markReadAndShowTyping(messageId: string): Promise<void> {
  if (!hasWhatsAppCredentials()) {
    console.log(`[dry-run] would mark read + show typing for message ${messageId}`);
    return;
  }
  try {
    await graphPost(`${config.whatsapp.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    });
  } catch (err) {
    console.error(`markReadAndShowTyping failed for ${messageId}:`, err);
  }
}
