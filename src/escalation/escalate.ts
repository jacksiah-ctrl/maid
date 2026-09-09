import { getConversation, setBotPaused } from "../db/conversations.js";
import { getRecentMessages, type StoredMessage } from "../db/messages.js";
import { saveEscalation } from "../db/escalations.js";
import { sendText } from "../whatsapp/client.js";
import { sendTemplate } from "../whatsapp/templates.js";
import { loadOperatorConfig } from "./operatorConfig.js";

export interface EscalationInput {
  conversationId: string;
  reason: string;
  urgency: "low" | "medium" | "high";
  summary?: string;
}

export interface EscalationDeliveryDeps {
  sendFreeform: (to: string, body: string) => Promise<{ id: string | null }>;
  sendTemplateAlert: (to: string, templateName: string, languageCode: string, params: string[]) => Promise<{ id: string | null }>;
}

const realDeps: EscalationDeliveryDeps = {
  sendFreeform: sendText,
  sendTemplateAlert: sendTemplate,
};

function formatLastMessages(messages: StoredMessage[]): string {
  return messages
    .map((m) => {
      const who = m.direction === "inbound" ? "Enquirer" : "Bot";
      const body = m.message_type === "text" ? m.text_body ?? "" : `[${m.message_type}]`;
      return `${who}: ${body}`;
    })
    .join("\n");
}

/**
 * The real escalation flow: pause the conversation, attempt to notify the
 * operator (free-form first, template fallback, loud failure if both
 * fail), and record what actually happened. `deps` is injectable so this
 * exact logic — including the fallback and total-failure paths — can be
 * proven deterministically without live WhatsApp credentials; see
 * scripts/simulate-guardrails.ts.
 */
export async function escalate(input: EscalationInput, deps: EscalationDeliveryDeps = realDeps): Promise<void> {
  await setBotPaused(input.conversationId, true, input.reason);

  const [conversation, recentMessages] = await Promise.all([
    getConversation(input.conversationId),
    getRecentMessages(input.conversationId, 5),
  ]);
  const enquirerName = conversation?.enquirer_name ?? null;
  const summary = input.summary ?? "(no summary provided — see last messages below)";
  const lastMessagesText = formatLastMessages(recentMessages);

  const alertBody =
    `🔔 Escalation — ${input.urgency.toUpperCase()} urgency\n` +
    `From: ${enquirerName ?? "(name unknown)"} (${input.conversationId})\n` +
    `Reason: ${input.reason}\n` +
    `Summary: ${summary}\n\n` +
    `Last messages:\n${lastMessagesText}\n\n` +
    `Reply "resume ${input.conversationId}" to unpause, or "take ${input.conversationId}" to keep handling it yourself.`;

  const operatorConfig = await loadOperatorConfig();
  const operatorNumber = operatorConfig.operator_whatsapp_number;

  let deliveryMethod: "freeform" | "template" | "none" = "none";
  let status: "sent" | "failed" | "undelivered" = "undelivered";
  let errorDetail: string | null = null;

  try {
    await deps.sendFreeform(operatorNumber, alertBody);
    deliveryMethod = "freeform";
    status = "sent";
  } catch (freeformErr) {
    const freeformError = (freeformErr as Error).message;
    console.error(`[escalation] free-form alert to operator failed, trying template fallback: ${freeformError}`);
    try {
      await deps.sendTemplateAlert(operatorNumber, operatorConfig.alert_template.name, operatorConfig.alert_template.language_code, [
        enquirerName ?? input.conversationId,
        input.reason,
        summary,
      ]);
      deliveryMethod = "template";
      status = "sent";
      errorDetail = `freeform failed first: ${freeformError}`;
    } catch (templateErr) {
      const templateError = (templateErr as Error).message;
      deliveryMethod = "none";
      status = "undelivered";
      errorDetail = `freeform failed: ${freeformError} | template fallback also failed: ${templateError}`;
      // A silently dropped escalation is the worst failure mode in this
      // system. Loud, not a debug-level log — this must be impossible to
      // miss in server output.
      console.error(
        `\n########## ESCALATION DELIVERY FAILED — OPERATOR NOT NOTIFIED ##########\n` +
          `conversation=${input.conversationId} urgency=${input.urgency} reason="${input.reason}"\n` +
          `${errorDetail}\n` +
          `##########################################################################\n`,
      );
    }
  }

  await saveEscalation({
    conversation_id: input.conversationId,
    enquirer_name: enquirerName,
    enquirer_number: input.conversationId,
    reason: input.reason,
    urgency: input.urgency,
    summary,
    last_messages: recentMessages.map((m) => ({
      direction: m.direction,
      message_type: m.message_type,
      text_body: m.text_body ?? null,
      created_at: m.created_at,
    })),
    delivery_method: deliveryMethod,
    status,
    error_detail: errorDetail,
  });
}
