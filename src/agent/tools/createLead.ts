import { insertRow } from "../../db/genericInsert.js";
import type { AgentTool } from "./types.js";

interface CreateLeadInput {
  name: string;
  requirements_summary: string;
  urgency: "low" | "medium" | "high";
}

export const createLeadTool: AgentTool = {
  definition: {
    name: "create_lead",
    description:
      "Record a qualified lead for the agency's team to follow up on. Use once you have a name and a clear " +
      "picture of what the enquirer wants — don't wait for them to explicitly ask to be 'signed up'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "the enquirer's name" },
        requirements_summary: { type: "string", description: "2-3 sentence summary of what they're looking for" },
        urgency: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["name", "requirements_summary", "urgency"],
      additionalProperties: false,
    },
  },
  execute: async (rawInput, ctx) => {
    const input = rawInput as unknown as CreateLeadInput;
    await insertRow("leads", { conversation_id: ctx.conversationId, ...input });
    return { status: "saved", conversation_id: ctx.conversationId };
  },
};
