/**
 * Replays the golden set through the real agent pipeline (hard triggers
 * first, then the model loop when nothing hard-triggers — the same order
 * receive.ts uses) and writes a markdown report grading: did it answer,
 * did it call an expected tool, did it hallucinate a figure, did it
 * escalate when it should have.
 *
 * Escalation delivery is mocked/forced to dry-run here regardless of what
 * .env has configured — WhatsApp and Supabase credentials are stripped
 * from this process's env before anything runs, so escalate_to_human
 * calls during an eval NEVER reach a real phone or a real database. This
 * is a hard requirement from the brief, not a convenience.
 *
 * This runs BEFORE any system-prompt change, as the baseline to compare
 * future prompt edits against.
 *
 * Run: npm run run-evals
 *      ANTHROPIC_API_KEY=sk-ant-... npm run run-evals   (to actually grade
 *        model-dependent items — see the report's own header if this key
 *        isn't set; most items will show as SKIPPED, honestly, not faked)
 */

// Strip credentials from THIS process before importing anything that reads
// them at call time — must happen before other imports touch config.ts's
// cached process.env reads.
delete process.env.WHATSAPP_ACCESS_TOKEN;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkTextHardTriggers } from "../src/guardrails/hardTriggers.js";
import { checkOutboundReply } from "../src/guardrails/preSend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const EVALS_DIR = path.join(REPO_ROOT, "evals");
const REPORTS_DIR = path.join(EVALS_DIR, "reports");
const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

interface GoldenItem {
  id: string;
  opener: string;
  category: string;
  source_lines?: string;
  allowed_tools: string[] | null;
  should_escalate: boolean;
  notes: string | null;
}

interface SyntheticItem {
  id: string;
  opener: string;
  category: string;
  should_escalate: boolean;
  expect_hard_trigger: boolean;
  notes: string | null;
}

interface EvalResult {
  id: string;
  opener: string;
  category: string;
  status: "graded" | "skipped_no_api_key";
  answered: boolean | null;
  replyText: string | null;
  toolsCalled: string[];
  escalated: boolean;
  escalationSource: "hard_trigger" | "model" | null;
  toolCorrect: "pass" | "fail" | "n/a";
  hallucinationFlag: boolean;
  hallucinationReason: string | null;
  escalateCorrect: boolean;
  overallPass: boolean | null; // null when skipped
}

async function loadJson<T>(relPath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relPath), "utf-8"));
}

async function evalOpener(
  id: string,
  opener: string,
  category: string,
  shouldEscalate: boolean,
  allowedTools: string[] | null,
): Promise<EvalResult> {
  const hardTrigger = await checkTextHardTriggers(opener);

  if (hardTrigger) {
    return {
      id,
      opener,
      category,
      status: "graded",
      answered: true, // the hard-trigger ack message counts as an answer
      replyText: "(hard-trigger ack — not a model reply)",
      toolsCalled: [],
      escalated: true,
      escalationSource: "hard_trigger",
      toolCorrect: "n/a",
      hallucinationFlag: false,
      hallucinationReason: null,
      escalateCorrect: shouldEscalate === true,
      overallPass: shouldEscalate === true,
    };
  }

  if (!HAS_API_KEY) {
    return {
      id,
      opener,
      category,
      status: "skipped_no_api_key",
      answered: null,
      replyText: null,
      toolsCalled: [],
      escalated: false,
      escalationSource: null,
      toolCorrect: "n/a",
      hallucinationFlag: false,
      hallucinationReason: null,
      escalateCorrect: false,
      overallPass: null,
    };
  }

  const { runAgentTurn } = await import("../src/agent/loop.js");
  const systemPrompt = await readFile(path.join(REPO_ROOT, "src", "agent", "system-prompt.md"), "utf-8");
  const { replyText, toolCallLog } = await runAgentTurn(systemPrompt, [{ role: "user", content: opener }], {
    conversationId: `eval-${id}`,
  });

  const toolsCalled = toolCallLog.map((t) => t.name);
  const escalated = toolsCalled.includes("escalate_to_human");
  const preSend = checkOutboundReply(replyText, toolCallLog);

  let toolCorrect: "pass" | "fail" | "n/a" = "n/a";
  if (allowedTools !== null) {
    toolCorrect = allowedTools.length === 0 ? (toolsCalled.length === 0 ? "pass" : "fail") : toolsCalled.some((t) => allowedTools.includes(t)) ? "pass" : "fail";
  }

  const escalateCorrect = escalated === shouldEscalate;
  const overallPass = !preSend.blocked && toolCorrect !== "fail" && escalateCorrect;

  return {
    id,
    opener,
    category,
    status: "graded",
    answered: replyText.trim().length > 0,
    replyText,
    toolsCalled,
    escalated,
    escalationSource: escalated ? "model" : null,
    toolCorrect,
    hallucinationFlag: preSend.blocked,
    hallucinationReason: preSend.reason ?? null,
    escalateCorrect,
    overallPass,
  };
}

function summarize(results: EvalResult[]): { graded: number; skipped: number; passed: number; failed: number } {
  const graded = results.filter((r) => r.status === "graded");
  const skipped = results.filter((r) => r.status === "skipped_no_api_key");
  const passed = graded.filter((r) => r.overallPass === true);
  const failed = graded.filter((r) => r.overallPass === false);
  return { graded: graded.length, skipped: skipped.length, passed: passed.length, failed: failed.length };
}

function renderTable(results: EvalResult[]): string {
  const header = "| ID | Category | Status | Answered | Tools called | Tool ✓ | Escalated (src) | Escalate ✓ | Hallucination | Pass |\n" +
    "|---|---|---|---|---|---|---|---|---|---|";
  const rows = results.map((r) => {
    if (r.status === "skipped_no_api_key") {
      return `| ${r.id} | ${r.category} | SKIPPED | — | — | — | — | — | — | — |`;
    }
    return (
      `| ${r.id} | ${r.category} | graded | ${r.answered ? "yes" : "NO"} | ${r.toolsCalled.join(", ") || "(none)"} | ${r.toolCorrect} | ` +
      `${r.escalated} (${r.escalationSource ?? "-"}) | ${r.escalateCorrect ? "yes" : "NO"} | ${r.hallucinationFlag ? "**FLAGGED**" : "no"} | ${r.overallPass ? "✓" : "✗"} |`
    );
  });
  return [header, ...rows].join("\n");
}

function renderDetail(results: EvalResult[]): string {
  return results
    .map((r) => {
      const lines = [`### ${r.id} — ${r.category}`, "", "**Opener:**", "```", r.opener, "```", ""];
      if (r.status === "skipped_no_api_key") {
        lines.push("_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._");
      } else {
        lines.push(`**Reply:**\n\`\`\`\n${r.replyText}\n\`\`\``);
        lines.push(`**Tools called:** ${r.toolsCalled.join(", ") || "(none)"}`);
        lines.push(`**Escalated:** ${r.escalated} (source: ${r.escalationSource ?? "n/a"}, expected: matches=${r.escalateCorrect})`);
        if (r.hallucinationFlag) lines.push(`**⚠️ Hallucination guardrail flagged this reply:** ${r.hallucinationReason}`);
        lines.push(`**Overall:** ${r.overallPass ? "PASS" : "FAIL"}`);
      }
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

async function main() {
  const goldenSet = await loadJson<{ items: GoldenItem[] }>("evals/golden-set.json");
  const supplement = await loadJson<{ items: SyntheticItem[] }>("evals/golden-set-supplement-synthetic.json");

  console.log(`Running ${goldenSet.items.length} real openers + ${supplement.items.length} synthetic supplement items...`);
  console.log(HAS_API_KEY ? "ANTHROPIC_API_KEY is set — model-dependent items will run for real." : "No ANTHROPIC_API_KEY — only hard-trigger-catchable items will be graded; the rest are honestly reported as SKIPPED, not faked.\n");

  const mainResults: EvalResult[] = [];
  for (const item of goldenSet.items) {
    const result = await evalOpener(item.id, item.opener, item.category, item.should_escalate, item.allowed_tools);
    mainResults.push(result);
    console.log(`  ${item.id}: ${result.status}${result.status === "graded" ? ` — ${result.overallPass ? "PASS" : "FAIL"}` : ""}`);
  }

  const supplementResults: EvalResult[] = [];
  for (const item of supplement.items) {
    const result = await evalOpener(item.id, item.opener, item.category, item.should_escalate, null);
    supplementResults.push(result);
    console.log(`  [supplement] ${item.id}: ${result.status}${result.status === "graded" ? ` — ${result.overallPass ? "PASS" : "FAIL"}` : ""}`);
  }

  const mainSummary = summarize(mainResults);
  const supplementSummary = summarize(supplementResults);

  const reportLines: string[] = [];
  reportLines.push("# Eval report — baseline");
  reportLines.push("");
  reportLines.push(`Run: ${new Date().toISOString()}`);
  reportLines.push(`ANTHROPIC_API_KEY present: ${HAS_API_KEY}`);
  reportLines.push("");
  if (!HAS_API_KEY) {
    reportLines.push(
      "> **No baseline pass rate exists for the 30-item real golden set in this run — every item is honestly reported as " +
        "SKIPPED, not estimated or faked.** This sandbox has no `ANTHROPIC_API_KEY` available (confirmed via a real API call — " +
        "see the Phase 3 README section). None of the 30 real openers are catchable by a hard trigger on their own (the real " +
        "transcript has no complaint/payment/human-request phrasing — see evals/README.md for why), so all 30 require a live " +
        "model call this run can't make. Only the synthetic supplement's hard-trigger items (s01, s02, s03, s06) get graded " +
        "here, since those bypass the model entirely by design. Re-run with a real key to get the actual baseline.",
    );
    reportLines.push("");
  }
  reportLines.push("## Summary — 30-item real golden set");
  reportLines.push("");
  reportLines.push(`Graded: ${mainSummary.graded}/30 · Skipped (no API key): ${mainSummary.skipped}/30`);
  reportLines.push(mainSummary.graded > 0 ? `Pass rate among graded items: ${mainSummary.passed}/${mainSummary.graded} (${((mainSummary.passed / mainSummary.graded) * 100).toFixed(0)}%)` : "Pass rate: N/A (nothing graded this run)");
  reportLines.push("");
  reportLines.push(renderTable(mainResults));
  reportLines.push("");
  reportLines.push("## Summary — synthetic escalation-coverage supplement (NOT part of the 30-item baseline)");
  reportLines.push("");
  reportLines.push(`Graded: ${supplementSummary.graded}/${supplement.items.length} · Skipped: ${supplementSummary.skipped}/${supplement.items.length}`);
  reportLines.push(supplementSummary.graded > 0 ? `Pass rate among graded items: ${supplementSummary.passed}/${supplementSummary.graded}` : "Pass rate: N/A");
  reportLines.push("");
  reportLines.push(renderTable(supplementResults));
  reportLines.push("");
  reportLines.push("## Per-item detail — real golden set");
  reportLines.push("");
  reportLines.push(renderDetail(mainResults));
  reportLines.push("");
  reportLines.push("## Per-item detail — synthetic supplement");
  reportLines.push("");
  reportLines.push(renderDetail(supplementResults));
  reportLines.push("");

  await mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, "baseline.md");
  await writeFile(reportPath, reportLines.join("\n") + "\n");

  console.log(`\nReport written to ${path.relative(REPO_ROOT, reportPath)}`);
  console.log(
    mainSummary.graded > 0
      ? `Real-set pass rate: ${mainSummary.passed}/${mainSummary.graded} graded (${mainSummary.skipped} skipped)`
      : `Real-set: 0 graded, ${mainSummary.skipped} skipped — no ANTHROPIC_API_KEY. This is the honest result, not an error.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
