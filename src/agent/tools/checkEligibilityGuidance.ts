import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "./types.js";

const CONFIG_PATH = path.resolve(process.cwd(), "config", "mom-eligibility-reference.json");

export const checkEligibilityGuidanceTool: AgentTool = {
  definition: {
    name: "check_eligibility_guidance",
    description:
      "Returns published MOM eligibility criteria as reference text ONLY — this tool never evaluates whether a specific " +
      "household qualifies. household_composition is accepted purely to give a human follow-up context (e.g. for a lead " +
      "or escalation); it has zero effect on what's returned, by design, so this can never produce a personalized ruling. " +
      "Always frame the result to the enquirer as 'general reference, please verify with MOM' — never as a yes/no answer.",
    input_schema: {
      type: "object",
      properties: {
        household_composition: {
          type: "string",
          description: "free-text description of the household (e.g. ages of children, elderly/disabled members) — logged for context only, not evaluated",
        },
      },
      required: ["household_composition"],
      additionalProperties: false,
    },
  },
  execute: async (input) => {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    return {
      as_of: config.as_of,
      status: config.status,
      categories: config.categories,
      always_append: config.always_append,
      logged_household_composition: (input as { household_composition: string }).household_composition,
    };
  },
};
