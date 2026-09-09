import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabase } from "../../db/client.js";
import type { AgentTool } from "./types.js";

const DRY_RUN_HELPERS_FILE = path.resolve(process.cwd(), "scripts", "output", "helpers.dry-run.json");

interface HelperRow {
  name: string;
  nationality: string | null;
  age: number | null;
  marital_status: string | null;
  num_children: number | null;
  years_experience: number | null;
  prior_work_placements: string[] | null;
  skills: Record<string, boolean | null> | null;
  languages: string[] | null;
  expected_salary_monthly: number | null;
  off_day_expectation: string | null;
  availability_status: string | null;
}

interface SearchInput {
  nationality?: string;
  min_experience?: number;
  skills?: string[];
  max_salary?: number;
  off_day_preference?: string;
}

async function loadHelpers(): Promise<HelperRow[]> {
  const supabase = getSupabase();
  if (!supabase) {
    try {
      const raw = await readFile(DRY_RUN_HELPERS_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const { data, error } = await supabase.from("helpers").select("*");
  if (error) throw new Error(`search_helpers query failed: ${error.message}`);
  return (data ?? []) as HelperRow[];
}

/**
 * Filter policy, applied consistently: a numeric/boolean filter EXCLUDES a
 * candidate whose matching field is null (unknown never passes a "must
 * satisfy" filter — this fails safe rather than guessing a null qualifies).
 * off_day_preference is NOT used as a filter — off-day phrasing on both
 * sides is loose natural language, better compared by the model reading
 * each result's off_day_expectation than by brittle string matching here.
 */
function matches(helper: HelperRow, input: SearchInput): boolean {
  if (input.nationality && helper.nationality?.toUpperCase() !== input.nationality.toUpperCase()) {
    return false;
  }
  if (input.min_experience !== undefined) {
    if (helper.years_experience === null || helper.years_experience < input.min_experience) return false;
  }
  if (input.max_salary !== undefined) {
    if (helper.expected_salary_monthly === null || helper.expected_salary_monthly > input.max_salary) return false;
  }
  if (input.skills && input.skills.length > 0) {
    if (!helper.skills) return false;
    for (const skill of input.skills) {
      if (helper.skills[skill] !== true) return false;
    }
  }
  return true;
}

export const searchHelpersTool: AgentTool = {
  definition: {
    name: "search_helpers",
    description:
      "Search the agency's helper inventory. All parameters are optional filters (omit to browse everything). " +
      "A numeric or skill filter excludes any candidate whose matching field isn't recorded (unknown never passes a filter) — " +
      "so a narrow search can legitimately return fewer results than exist, not because they don't qualify but because it isn't on file yet. " +
      "off_day_preference is not filtered on — it's echoed per-result so you can compare it yourself against what the enquirer wants.",
    input_schema: {
      type: "object",
      properties: {
        nationality: { type: "string", description: "e.g. 'Indonesian', 'Filipino'" },
        min_experience: { type: "number", description: "minimum years of relevant work experience" },
        skills: {
          type: "array",
          items: {
            type: "string",
            enum: ["infant_care", "elderly_care", "handicap_care", "general_housework", "cooking", "pets"],
          },
          description: "required skills — a candidate must have every listed skill marked true",
        },
        max_salary: { type: "number", description: "maximum acceptable monthly basic salary in SGD" },
        off_day_preference: {
          type: "string",
          description: "free-text off-day preference, informational only — not used to filter results",
        },
      },
      additionalProperties: false,
    },
  },
  execute: async (input) => {
    const helpers = await loadHelpers();
    const filtered = helpers.filter((h) => matches(h, input as SearchInput));
    return {
      count: filtered.length,
      total_in_inventory: helpers.length,
      results: filtered.map((h) => ({
        name: h.name,
        nationality: h.nationality,
        age: h.age,
        marital_status: h.marital_status,
        num_children: h.num_children,
        years_experience: h.years_experience,
        prior_work_placements: h.prior_work_placements,
        skills: h.skills,
        languages: h.languages,
        expected_salary_monthly: h.expected_salary_monthly,
        off_day_expectation: h.off_day_expectation,
        availability_status: h.availability_status,
      })),
    };
  },
};
