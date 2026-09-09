import { readFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_PATH = path.resolve(process.cwd(), "config", "escalation-rules.json");

interface EscalationRulesConfig {
  human_request_keywords: string[];
  complaint_keywords: string[];
  payment_or_transfer_keywords: string[];
  no_progress_turn_threshold: number;
}

let cachedConfig: EscalationRulesConfig | null = null;
async function loadConfig(): Promise<EscalationRulesConfig> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
  return cachedConfig!;
}

export interface HardTrigger {
  reason: string;
  urgency: "low" | "medium" | "high";
}

function containsAny(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  return keywords.find((kw) => lower.includes(kw.toLowerCase())) ?? null;
}

/**
 * Text-based hard triggers — fire regardless of what the model would have
 * done, checked BEFORE the message ever reaches the agent loop. Simple
 * keyword matching on purpose: this is a prototype guardrail meant to
 * fail toward escalating too often, not a classifier. Edit
 * config/escalation-rules.json to tune the lists, not this file.
 */
export async function checkTextHardTriggers(text: string): Promise<HardTrigger | null> {
  const rules = await loadConfig();

  const humanRequestHit = containsAny(text, rules.human_request_keywords);
  if (humanRequestHit) {
    return { reason: `Enquirer asked for a human (matched: "${humanRequestHit}")`, urgency: "medium" };
  }

  const complaintHit = containsAny(text, rules.complaint_keywords);
  if (complaintHit) {
    return { reason: `Enquirer appears to have a complaint (matched: "${complaintHit}")`, urgency: "high" };
  }

  const paymentHit = containsAny(text, rules.payment_or_transfer_keywords);
  if (paymentHit) {
    return { reason: `Message mentions payment/transfer (matched: "${paymentHit}") — never handle this via the bot`, urgency: "high" };
  }

  return null;
}

/**
 * Every inbound IMAGE is treated as a possible passport/NRIC photo — a
 * deliberately broad default. Documents (PDFs) are NOT covered by this:
 * the seed transcript shows biodata PDFs forwarded constantly as normal
 * business, so auto-escalating every PDF would make the bot unusable;
 * photos taken on a phone are the natural way someone actually sends an ID
 * snapshot. This never inspects image CONTENT (no vision call is made —
 * the brief is explicit that identity-document media must never reach the
 * model at all), so it can't distinguish an actual passport photo from a
 * photo of, say, a helper's biodata printout. Fail toward flagging.
 */
export function isLikelyIdentityDocumentImage(messageType: string): boolean {
  return messageType === "image";
}

export async function getNoProgressThreshold(): Promise<number> {
  const rules = await loadConfig();
  return rules.no_progress_turn_threshold;
}
