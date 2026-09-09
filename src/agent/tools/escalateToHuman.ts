import type { AgentTool } from "./types.js";

interface EscalateInput {
  reason: string;
  urgency: "low" | "medium" | "high";
}

/**
 * PHASE 3 STUB. The real implementation — pausing the conversation, sending
 * a real WhatsApp alert to the operator with 24h-window/template fallback,
 * writing to an escalations table with delivery status — is explicitly
 * Phase 4 scope (see the brief: "escalate_to_human(reason, urgency) → see
 * Phase 4"). This stub exists so the tool is callable end-to-end now and
 * the model can be taught to reach for it, without pretending an operator
 * has actually been notified. It is loud on purpose: a stub that silently
 * looks like success is worse than one that shouts "not real yet."
 */
export const escalateToHumanTool: AgentTool = {
  definition: {
    name: "escalate_to_human",
    description:
      "Hand off to a human operator. Call this whenever you're about to state a price/timeline/eligibility figure " +
      "not available from your tools, the enquirer asks for a human, sends what looks like an identity document, " +
      "expresses a complaint, or mentions payment/transfer. NOTE: in this build, escalation delivery is stubbed " +
      "(logged only) — Phase 4 wires the real WhatsApp alert to the operator. Still call this tool when warranted; " +
      "tell the enquirer a human will follow up, but don't claim they've been notified by name/number yet.",
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
    console.error(
      `[ESCALATION STUB — Phase 4 will deliver this for real] conversation=${ctx.conversationId} urgency=${input.urgency} reason="${input.reason}"`,
    );
    return {
      status: "logged_stub_only",
      note: "Escalation logged to server console. No real WhatsApp alert was sent — that's Phase 4. Do not tell the enquirer 'the operator has been notified'; say a human will follow up.",
    };
  },
};
