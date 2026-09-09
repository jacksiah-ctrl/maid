/**
 * Every candidate reply to the enquirer passes through here before it's
 * sent. Two checks, both heuristic and deliberately over-cautious — false
 * positives (blocking a harmless sentence) are the acceptable failure
 * mode here, a leaked unapproved number or a promised date is not.
 */

const DOLLAR_FIGURE_RE = /\$\s?([\d,]+(?:\.\d{1,2})?)/g;

const COMMITMENT_VERB_RE = /\b(will be|will arrive|will receive|will get|will take|guaranteed?|confirmed?|definitely|for sure|promise)\b/gi;
const DATE_TOKEN_RE =
  /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\btomorrow\b|\bnext week\b|\b\d{1,2}\s*(days?|weeks?|months?)\b|\b\d{1,2}\/\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const COMMITMENT_LOOKAHEAD_CHARS = 40;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function extractDollarFigures(text: string): number[] {
  const figures: number[] = [];
  for (const match of text.matchAll(DOLLAR_FIGURE_RE)) {
    const n = parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isNaN(n)) figures.push(n);
  }
  return figures;
}

function collectApprovedNumbers(toolCallLog: Array<{ result: unknown }>): Set<number> {
  const approved = new Set<number>();
  const visit = (value: unknown): void => {
    if (typeof value === "number") {
      approved.add(round2(value));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  toolCallLog.forEach((call) => visit(call.result));
  return approved;
}

function hasDateCommitment(text: string): boolean {
  for (const match of text.matchAll(COMMITMENT_VERB_RE)) {
    const windowStart = match.index ?? 0;
    const window = text.slice(windowStart, windowStart + match[0].length + COMMITMENT_LOOKAHEAD_CHARS);
    if (DATE_TOKEN_RE.test(window)) return true;
  }
  return false;
}

export interface PreSendCheckResult {
  blocked: boolean;
  reason?: string;
}

export function checkOutboundReply(replyText: string, toolCallLog: Array<{ result: unknown }>): PreSendCheckResult {
  const approved = collectApprovedNumbers(toolCallLog);
  const figures = extractDollarFigures(replyText);
  const unapproved = figures.filter((f) => !approved.has(round2(f)));
  if (unapproved.length > 0) {
    return {
      blocked: true,
      reason: `draft reply contains dollar figure(s) not returned by any tool call this turn: ${unapproved.map((f) => `$${f}`).join(", ")}`,
    };
  }

  if (hasDateCommitment(replyText)) {
    return {
      blocked: true,
      reason: "draft reply appears to make a date/timeline commitment (commitment verb near a date token)",
    };
  }

  return { blocked: false };
}
