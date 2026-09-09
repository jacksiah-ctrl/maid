import type Anthropic from "@anthropic-ai/sdk";
import { searchHelpersTool } from "./searchHelpers.js";
import { calculateCostTool } from "./calculateCost.js";
import { checkEligibilityGuidanceTool } from "./checkEligibilityGuidance.js";
import { createLeadTool } from "./createLead.js";
import { bookAppointmentTool } from "./bookAppointment.js";
import { escalateToHumanTool } from "./escalateToHuman.js";
import type { AgentTool, ToolContext } from "./types.js";

const allTools: AgentTool[] = [
  searchHelpersTool,
  calculateCostTool,
  checkEligibilityGuidanceTool,
  createLeadTool,
  bookAppointmentTool,
  escalateToHumanTool,
];

export const toolDefinitions: Anthropic.Tool[] = allTools.map((t) => t.definition);

const toolsByName = new Map(allTools.map((t) => [t.definition.name, t]));

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const tool = toolsByName.get(name);
  if (!tool) {
    return { error: `Unknown tool "${name}"` };
  }
  return tool.execute(input, ctx);
}

export type { ToolContext } from "./types.js";
