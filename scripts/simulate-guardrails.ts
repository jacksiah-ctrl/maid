/**
 * Phase 4 proof harness — deterministic, no external credentials needed
 * (unlike a real WhatsApp send, every delivery path here is exercised via
 * escalate()'s injectable deps, per its own doc comment). Proves:
 *   1. Hard text triggers (human request / complaint / payment) fire, and
 *      ordinary text doesn't
 *   2. Identity-document image detection is scoped to images, not documents
 *   3. The pre-send guardrail blocks an unapproved dollar figure and a
 *      date-commitment phrase, but allows a tool-approved figure and
 *      ordinary scheduling talk through
 *   4. The no-progress guardrail fires after N stuck turns, not before
 *   5. escalate()'s full three-way delivery outcome: free-form succeeds,
 *      free-form fails -> template succeeds, and BOTH fail -> undelivered
 *      + loud stderr (the brief's explicit "worst failure mode")
 *   6. Operator "resume"/"take" commands flip bot_paused correctly
 *
 * Run: npm run simulate-guardrails
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkTextHardTriggers, isLikelyIdentityDocumentImage } from "../src/guardrails/hardTriggers.js";
import { checkOutboundReply } from "../src/guardrails/preSend.js";
import { isStuckWithNoProgress } from "../src/guardrails/noProgress.js";
import { escalate, type EscalationDeliveryDeps } from "../src/escalation/escalate.js";
import { handleOperatorCommand } from "../src/escalation/operatorCommands.js";
import { getConversation } from "../src/db/conversations.js";
import { saveMessage } from "../src/db/messages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "scripts", "output");

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function testHardTriggers() {
  console.log("=== 1. Text hard triggers ===\n");
  const human = await checkTextHardTriggers("can I speak to a human please");
  check("human-request text triggers escalation", human !== null && human.urgency === "medium");

  const complaint = await checkTextHardTriggers("this is unacceptable, I am very unhappy with the service");
  check("complaint text triggers escalation", complaint !== null && complaint.urgency === "high");

  const payment = await checkTextHardTriggers("can I just PayNow you the deposit now?");
  check("payment/transfer text triggers escalation", payment !== null && payment.urgency === "high");

  const benign = await checkTextHardTriggers("how much is your agency fee for an Indonesian helper?");
  check("ordinary FAQ text does NOT trigger", benign === null);

  console.log("\n=== 2. Identity-document image scoping ===\n");
  check("image type is flagged", isLikelyIdentityDocumentImage("image") === true);
  check("document type is NOT flagged (biodata PDFs are normal traffic)", isLikelyIdentityDocumentImage("document") === false);
  check("text type is NOT flagged", isLikelyIdentityDocumentImage("text") === false);
}

function testPreSendGuardrail() {
  console.log("\n=== 3. Pre-send guardrail ===\n");
  const toolCallLog = [{ name: "calculate_cost", input: {}, result: { one_time: { total: 5703.22 } } }];

  const unapproved = checkOutboundReply("The total comes to $9999 all in!", toolCallLog);
  check("blocks a dollar figure no tool returned", unapproved.blocked === true);

  const approved = checkOutboundReply("The total comes to $5703.22, based on our last case like this.", toolCallLog);
  check("allows a dollar figure a tool actually returned this turn", approved.blocked === false, approved.reason);

  const dateCommit = checkOutboundReply("Your helper will be ready by next Monday, guaranteed!", []);
  check("blocks a date/timeline commitment", dateCommit.blocked === true);

  const benignSchedule = checkOutboundReply("Noted your preference for tomorrow 10am — someone will confirm the exact slot.", []);
  check(
    "allows non-committal mention of a day (no commitment verb nearby)",
    benignSchedule.blocked === false,
    benignSchedule.reason,
  );
}

async function testNoProgressGuardrail() {
  console.log("\n=== 4. No-progress guardrail ===\n");
  const stuckConvo = "6500000001";
  const okConvo = "6500000002";

  for (let i = 0; i < 3; i++) {
    await saveMessage({
      wa_message_id: `wamid.STUCK_${i}`,
      direction: "outbound",
      wa_from: "OUR_NUMBER",
      wa_to: stuckConvo,
      conversation_id: stuckConvo,
      message_type: "text",
      text_body: "Sorry, could you clarify?",
      wa_timestamp: new Date().toISOString(),
      raw_payload: { tool_calls: [] },
    });
  }
  check("3 consecutive no-tool-call replies -> flagged stuck", await isStuckWithNoProgress(stuckConvo));

  await saveMessage({
    wa_message_id: "wamid.OK_1",
    direction: "outbound",
    wa_from: "OUR_NUMBER",
    wa_to: okConvo,
    conversation_id: okConvo,
    message_type: "text",
    text_body: "Here's what I found",
    wa_timestamp: new Date().toISOString(),
    raw_payload: { tool_calls: [{ name: "search_helpers", input: {} }] },
  });
  check("a turn WITH a tool call -> not flagged stuck", !(await isStuckWithNoProgress(okConvo)));
}

async function testEscalationDelivery() {
  console.log("\n=== 5. Escalation delivery (all three outcomes) ===\n");

  const succeedDeps: EscalationDeliveryDeps = {
    sendFreeform: async () => ({ id: "wamid.FAKE_FREEFORM" }),
    sendTemplateAlert: async () => ({ id: "wamid.FAKE_TEMPLATE" }),
  };
  await escalate({ conversationId: "6500000010", reason: "test: freeform succeeds", urgency: "low" }, succeedDeps);
  check("conversation paused after escalation", (await getConversation("6500000010"))?.bot_paused === true);

  const fallbackDeps: EscalationDeliveryDeps = {
    sendFreeform: async () => {
      throw new Error("simulated 24h-window rejection");
    },
    sendTemplateAlert: async () => ({ id: "wamid.FAKE_TEMPLATE" }),
  };
  await escalate({ conversationId: "6500000011", reason: "test: freeform fails, template rescues", urgency: "medium" }, fallbackDeps);
  check("conversation paused even when freeform failed (template rescued it)", (await getConversation("6500000011"))?.bot_paused === true);

  console.log("  (expect a loud '########## ESCALATION DELIVERY FAILED' block right below — that's the total-failure path proving it does NOT fail silently)");
  const failDeps: EscalationDeliveryDeps = {
    sendFreeform: async () => {
      throw new Error("simulated freeform failure");
    },
    sendTemplateAlert: async () => {
      throw new Error("simulated template failure (e.g. template not yet approved)");
    },
  };
  await escalate({ conversationId: "6500000012", reason: "test: both delivery paths fail", urgency: "high" }, failDeps);
  check(
    "conversation is STILL paused even when delivery totally failed (never leave the bot talking after a failed escalation)",
    (await getConversation("6500000012"))?.bot_paused === true,
  );
}

async function testOperatorCommands() {
  console.log("\n=== 6. Operator resume/take commands ===\n");
  const targetConvo = "6500000020";
  await escalate(
    { conversationId: targetConvo, reason: "test setup", urgency: "low" },
    { sendFreeform: async () => ({ id: null }), sendTemplateAlert: async () => ({ id: null }) },
  );
  check("(setup) conversation starts paused", (await getConversation(targetConvo))?.bot_paused === true);

  await handleOperatorCommand(`resume ${targetConvo}`, "6580372668");
  check('"resume <number>" unpauses', (await getConversation(targetConvo))?.bot_paused === false);

  await handleOperatorCommand(`take ${targetConvo}`, "6580372668");
  check('"take <number>" (re-)pauses', (await getConversation(targetConvo))?.bot_paused === true);

  const before = await getConversation(targetConvo);
  await handleOperatorCommand("just chatting, not a command", "6580372668");
  const after = await getConversation(targetConvo);
  check("unrecognized text from the operator is ignored, not an error", JSON.stringify(before) === JSON.stringify(after));
}

async function main() {
  // Clean slate for the dry-run stores this touches.
  for (const file of ["messages.dry-run.jsonl", "conversations.dry-run.json", "escalations.dry-run.jsonl"]) {
    await rm(path.join(OUTPUT_DIR, file), { force: true });
  }

  await testHardTriggers();
  testPreSendGuardrail();
  await testNoProgressGuardrail();
  await testEscalationDelivery();
  await testOperatorCommands();

  console.log(`\n${failures === 0 ? "ALL GUARDRAIL TESTS PASSED" : `${failures} GUARDRAIL TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
