import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "./types.js";

const FEES_CONFIG_PATH = path.resolve(process.cwd(), "config", "fees.json");

interface FeeLineItem {
  key: string;
  label: string;
  amount: number;
  gst_taxable: boolean;
  note?: string;
}

interface NationalityFees {
  status: string;
  source?: string;
  one_time_items: FeeLineItem[] | null;
  gst_rate?: number;
  security_bond_or_deposit?: unknown;
  note?: string;
}

interface FeesConfig {
  currency: string;
  nationalities: Record<string, Record<string, NationalityFees>>;
  guarantee_period: unknown;
  mom_levy: { amount_monthly: number | null; status: string; note: string };
  salary_reference: unknown;
}

let cachedConfig: FeesConfig | null = null;
async function loadFeesConfig(): Promise<FeesConfig> {
  // Intentionally re-read on cache miss only, not on every call — config is
  // meant to be hand-edited between runs, and a long-lived process (the
  // Fastify server) shouldn't need a restart to pick up a fee change is a
  // NICE property but not promised here; simplicity wins for a prototype.
  // Read the note in README before relying on hot-reload.
  if (cachedConfig) return cachedConfig;
  const raw = await readFile(FEES_CONFIG_PATH, "utf-8");
  cachedConfig = JSON.parse(raw);
  return cachedConfig!;
}

interface CalculateCostInput {
  nationality: string;
  helper_salary: number;
  employer_type: "new_helper" | "transfer";
}

export const calculateCostTool: AgentTool = {
  definition: {
    name: "calculate_cost",
    description:
      "Look up an itemised cost breakdown for hiring a helper, reading only from config/fees.json — the single " +
      "editable source of truth. Returns one-time upfront costs separately from recurring monthly costs. " +
      "If this nationality/employer_type combination isn't on file, returns status 'not_on_file' with a TODO_VERIFY " +
      "note instead of estimating — treat that as a signal to escalate_to_human for a manual quote, never fill the gap yourself.",
    input_schema: {
      type: "object",
      properties: {
        nationality: { type: "string", description: "e.g. 'Indonesian'" },
        helper_salary: { type: "number", description: "the specific helper's agreed/quoted monthly basic salary in SGD" },
        employer_type: {
          type: "string",
          enum: ["new_helper", "transfer"],
          description: "'new_helper' = recruiting a first-timer from overseas; 'transfer' = an existing in-Singapore helper switching employer",
        },
      },
      required: ["nationality", "helper_salary", "employer_type"],
      additionalProperties: false,
    },
  },
  execute: async (rawInput) => {
    const input = rawInput as unknown as CalculateCostInput;
    const config = await loadFeesConfig();
    const nat = config.nationalities[input.nationality.toUpperCase()];
    const fees = nat?.[input.employer_type];

    if (!fees || fees.status !== "populated" || !fees.one_time_items) {
      return {
        status: "not_on_file",
        nationality: input.nationality,
        employer_type: input.employer_type,
        message:
          `No verified cost breakdown exists yet for nationality="${input.nationality}", employer_type="${input.employer_type}". ` +
          `TODO_VERIFY — do not estimate this from another nationality or from the new_helper figures. Escalate to a human for an accurate quote.`,
        note: fees?.note ?? null,
      };
    }

    const oneTimeSubtotal = fees.one_time_items.reduce((sum, item) => sum + item.amount, 0);
    const gstRate = fees.gst_rate ?? 0;
    const gstAmount = fees.one_time_items
      .filter((item) => item.gst_taxable)
      .reduce((sum, item) => sum + item.amount, 0) * gstRate;
    const oneTimeTotal = oneTimeSubtotal + gstAmount;

    return {
      status: "ok",
      currency: config.currency,
      nationality: input.nationality,
      employer_type: input.employer_type,
      source: fees.source,
      one_time: {
        items: fees.one_time_items,
        subtotal: round2(oneTimeSubtotal),
        gst_rate: gstRate,
        gst_amount: round2(gstAmount),
        total: round2(oneTimeTotal),
      },
      recurring_monthly: {
        helper_salary: input.helper_salary,
        mom_levy: config.mom_levy,
      },
      guarantee_period: config.guarantee_period,
      security_bond_or_deposit: fees.security_bond_or_deposit ?? null,
      caveat:
        "This is an indicative breakdown from the agency's own records for a comparable past case, not a binding quote. " +
        "MOM levy is not included pending verification — mention that explicitly if you state a monthly total.",
    };
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
