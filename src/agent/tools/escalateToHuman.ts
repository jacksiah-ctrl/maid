import { escalate } from "../../escalation/escalate.js";
import type { AgentTool } from "./types.js";

interface EscalateInput {
  reason: string;
  urgency: "low" | "medium" | "high";
}

export const escalateToHumanTool: AgentTool = {
  definition: {
    name: "escalate_to_human",
    description:
      "Hand off to a human operator — pauses this conversation (the bot goes silent until an operator resumes it) and " +
      "sends a real WhatsApp alert to the operator with the enquirer's details, the reason, urgency, and the last few " +
      "messages verbatim. Call this whenever you're about to state a price/timeline/eligibility figure not available " +
      "from your tools, the enquirer asks for a human, sends what looks like an identity document, expresses a " +
      "complaint, or mentions payment/transfer. After calling this, tell the enquirer a human will follow up soon — " +
      "don't promise a specific time.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        urgency: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["reason", "urgency"],
      additionalProperties: false,
    },
  },
  execute: async (rawInput, ctx) => {
    const input = rawInput as unknown as EscalateInput;
    await escalate({ conversationId: ctx.conversationId, reason: input.reason, urgency: input.urgency });
    return {
      status: "escalated",
      note: "Conversation paused and operator alert attempted (see server logs / escalations table for delivery status). Tell the enquirer a human will follow up — don't claim a specific response time.",
    };
  },
};
