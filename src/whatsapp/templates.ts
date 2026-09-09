import { config, hasWhatsAppCredentials } from "../config.js";

function graphUrl(pathSegment: string): string {
  return `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${pathSegment}`;
}

/**
 * Sends an approved WhatsApp message template — the only way to message
 * someone outside the 24h customer-service window. The template itself is
 * defined and approved in the Meta App Dashboard beforehand (see README's
 * Phase 4 section for the submission steps); this just fills in its body
 * parameters, in order, at send-time.
 *
 * Without WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID set, logs what it
 * would send and returns a synthetic id — same dry-run posture as
 * client.ts's sendText.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
): Promise<{ id: string | null }> {
  if (!hasWhatsAppCredentials()) {
    console.log(`[dry-run] would send template "${templateName}" to ${to} with params ${JSON.stringify(bodyParams)}`);
    return { id: null };
  }

  const res = await fetch(graphUrl(`${config.whatsapp.phoneNumberId}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`WhatsApp template send failed (${res.status}): ${JSON.stringify(json)}`);
  }
  const result = json as { messages?: Array<{ id: string }> };
  return { id: result.messages?.[0]?.id ?? null };
}
