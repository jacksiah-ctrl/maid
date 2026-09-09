/**
 * Phase 3 proof harness, split into two parts:
 *
 * 1. Deterministic tool unit tests (no API key needed) — proves the six
 *    tools the model can call are individually correct: calculate_cost's
 *    math against the real invoice, search_helpers' filter policy against
 *    Phase 1's real biodata record, create_lead/book_appointment
 *    persistence, check_eligibility_guidance's TODO_VERIFY shell. This
 *    ALWAYS runs and its pass/fail determines the script's exit code.
 *
 * 2. A live-model smoke test (only if ANTHROPIC_API_KEY is set) — runs a
 *    few real enquiries drawn from Phase 0's golden quotes through the
 *    actual agent loop and prints what it did. This is NOT a graded eval
 *    (that's Phase 5's job) — it's a "does this actually work end to end"
 *    check you read with your own eyes. Skipped, not failed, without a key
 *    — same posture as Phase 2's live-WhatsApp proof.
 *
 * Run: npm run simulate-agent
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeTool } from "../src/agent/tools/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "scripts", "output");
const CTX = { conversationId: "6591234567" };

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function readJsonlRows(file: string): Promise<any[]> {
  try {
    const contents = await readFile(path.join(OUTPUT_DIR, file), "utf-8");
    return contents.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function toolTests(): Promise<void> {
  console.log("=== Part 1: deterministic tool unit tests ===\n");

  console.log("calculate_cost — Indonesian new_helper (real invoice case)");
  const cost = (await executeTool(
    "calculate_cost",
    { nationality: "Indonesian", helper_salary: 550, employer_type: "new_helper" },
    CTX,
  )) as any;
  check("status ok", cost.status === "ok");
  check(`one_time.subtotal === 5510.57 (got ${cost.one_time?.subtotal})`, cost.one_time?.subtotal === 5510.57);
  check(`one_time.gst_amount === 192.65 (got ${cost.one_time?.gst_amount})`, cost.one_time?.gst_amount === 192.65);
  check(`one_time.total === 5703.22 (got ${cost.one_time?.total})`, cost.one_time?.total === 5703.22, "must match the real invoice's Nett Total exactly");
  check("recurring_monthly.helper_salary echoes input", cost.recurring_monthly?.helper_salary === 550);
  check("recurring_monthly.mom_levy is flagged TODO_VERIFY, not a number", cost.recurring_monthly?.mom_levy?.status === "TODO_VERIFY" && cost.recurring_monthly?.mom_levy?.amount_monthly === null);

  console.log("\ncalculate_cost — Indonesian transfer (no data on file)");
  const transferCost = (await executeTool(
    "calculate_cost",
    { nationality: "Indonesian", helper_salary: 550, employer_type: "transfer" },
    CTX,
  )) as any;
  check("status not_on_file (must not estimate)", transferCost.status === "not_on_file");

  console.log("\ncalculate_cost — Filipino new_helper (no data on file)");
  const filipinoCost = (await executeTool(
    "calculate_cost",
    { nationality: "Filipino", helper_salary: 600, employer_type: "new_helper" },
    CTX,
  )) as any;
  check("status not_on_file (must not reuse Indonesian figures)", filipinoCost.status === "not_on_file");

  console.log("\nsearch_helpers — no filters");
  const allHelpers = (await executeTool("search_helpers", {}, CTX)) as any;
  check(`returns every record in inventory (count === total_in_inventory === ${allHelpers.total_in_inventory})`, allHelpers.count === allHelpers.total_in_inventory && allHelpers.total_in_inventory >= 1);

  console.log("\nsearch_helpers — skills=['pets'] (Lestari's biodata shows dog-care duties)");
  const petsSearch = (await executeTool("search_helpers", { skills: ["pets"] }, CTX)) as any;
  check("finds at least the one candidate with pets:true", petsSearch.count >= 1 && petsSearch.results.every((r: any) => r.name));

  console.log("\nsearch_helpers — min_experience=10 (excludes Lestari's 6 years — unknown/insufficient must fail the filter)");
  const experienceSearch = (await executeTool("search_helpers", { min_experience: 10 }, CTX)) as any;
  check("excludes candidates below the threshold", experienceSearch.count === 0);

  console.log("\nsearch_helpers — nationality='Filipino' (inventory has none)");
  const filipinoSearch = (await executeTool("search_helpers", { nationality: "Filipino" }, CTX)) as any;
  check("returns zero results, not an error", filipinoSearch.count === 0);

  console.log("\ncheck_eligibility_guidance — must never rule, only reference text");
  const eligibility = (await executeTool(
    "check_eligibility_guidance",
    { household_composition: "married couple, two young children" },
    CTX,
  )) as any;
  check("status flags unpopulated (honest, not a fabricated ruling)", String(eligibility.status).includes("TODO_VERIFY"));
  check("always includes the verify-with-MOM caveat", typeof eligibility.always_append === "string" && eligibility.always_append.toLowerCase().includes("mom"));

  console.log("\ncreate_lead — persists");
  await executeTool("create_lead", { name: "Test Enquirer", requirements_summary: "Wants an Indonesian helper, elderly care", urgency: "medium" }, CTX);
  const leadRows = await readJsonlRows("leads.dry-run.jsonl");
  check("lead row was written", leadRows.some((r) => r.name === "Test Enquirer" && r.conversation_id === CTX.conversationId));

  console.log("\nbook_appointment — persists");
  await executeTool("book_appointment", { preferred_slots: ["tomorrow 10am"] }, CTX);
  const apptRows = await readJsonlRows("appointments.dry-run.jsonl");
  check("appointment row was written as pending_confirmation", apptRows.some((r) => r.status === "pending_confirmation" && r.conversation_id === CTX.conversationId));

  console.log("\nescalate_to_human — stub is honest about not being real yet");
  const escalation = (await executeTool("escalate_to_human", { reason: "asked for a human", urgency: "high" }, CTX)) as any;
  check("stub says so explicitly, doesn't claim a real alert was sent", escalation.status === "logged_stub_only");
}

async function liveModelSmokeTest(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\n=== Part 2: live-model smoke test — SKIPPED ===");
    console.log("ANTHROPIC_API_KEY is not set in this environment, so the actual model can't be called here.");
    console.log("This is expected in this sandbox (see README's Phase 3 section for how to run it for real):");
    console.log("  ANTHROPIC_API_KEY=sk-ant-... npm run simulate-agent");
    return;
  }

  console.log("\n=== Part 2: live-model smoke test ===\n");
  const { runAgentTurn } = await import("../src/agent/loop.js");
  const { readFile: rf } = await import("node:fs/promises");
  const systemPrompt = await rf(path.join(REPO_ROOT, "src", "agent", "system-prompt.md"), "utf-8");

  // Representative openers, drawn from docs/phase0-analysis.md's golden
  // quotes — real phrasing from the seed transcript, not invented.
  const openers = [
    "how much is your agency fee for an Indonesian helper?",
    "can I see some candidate profiles? need someone good with elderly care",
    "is there a guarantee period if it doesn't work out?",
  ];

  for (const opener of openers) {
    console.log(`\n> "${opener}"`);
    const result = await runAgentTurn(systemPrompt, [{ role: "user", content: opener }], {
      conversationId: "6598765432",
    });
    console.log(`  tools called: ${result.toolCallLog.map((t) => t.name).join(", ") || "(none)"}`);
    console.log(`  reply: ${result.replyText}`);
  }

  console.log("\n(Read the replies above yourself — this is a smoke test, not a graded eval. Phase 5 builds the real golden-set eval.)");
}

async function main() {
  // Clean slate so the assertions above are checking what THIS run wrote,
  // not accumulated history from previous runs.
  await rm(path.join(OUTPUT_DIR, "leads.dry-run.jsonl"), { force: true });
  await rm(path.join(OUTPUT_DIR, "appointments.dry-run.jsonl"), { force: true });

  await toolTests();
  await liveModelSmokeTest();

  console.log(`\n${failures === 0 ? "ALL TOOL TESTS PASSED" : `${failures} TOOL TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
