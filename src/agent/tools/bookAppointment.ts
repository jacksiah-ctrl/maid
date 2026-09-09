import { insertRow } from "../../db/genericInsert.js";
import type { AgentTool } from "./types.js";

interface BookAppointmentInput {
  preferred_slots: string[];
}

export const bookAppointmentTool: AgentTool = {
  definition: {
    name: "book_appointment",
    description:
      "Record the enquirer's preferred interview/consultation slots. Calendar integration is stubbed for this " +
      "prototype — this saves a pending-confirmation request for a human to actually schedule; it does not book a " +
      "real calendar slot. Tell the enquirer a human will confirm the exact time, don't imply it's already locked in.",
    input_schema: {
      type: "object",
      properties: {
        preferred_slots: {
          type: "array",
          items: { type: "string" },
          description: "free-text preferred slots, e.g. ['tomorrow 10am', 'Saturday afternoon']",
        },
      },
      required: ["preferred_slots"],
      additionalProperties: false,
    },
  },
  execute: async (rawInput, ctx) => {
    const input = rawInput as unknown as BookAppointmentInput;
    await insertRow("appointments", {
      conversation_id: ctx.conversationId,
      preferred_slots: input.preferred_slots,
      status: "pending_confirmation",
    });
    return { status: "pending_confirmation", conversation_id: ctx.conversationId };
  },
};
