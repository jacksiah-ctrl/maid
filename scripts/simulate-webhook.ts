/**
 * Local proof harness for Phase 2, standing in for the real "echo bot over
 * ngrok on a live number" proof until real Meta credentials + a public URL
 * are available (see README's Phase 2 section for exactly what that needs
 * and why it can't happen inside this sandbox).
 *
 * Spins up the actual Fastify server as a child process, then drives it
 * with signed, realistic WhatsApp Cloud API webhook payloads to prove:
 *   1. GET /webhook verification handshake (correct + wrong token)
 *   2. POST /webhook rejects a bad/missing X-Hub-Signature-256
 *   3. POST /webhook acks fast (200 before processing finishes) and the
 *      echo bot actually persists + replies
 *   4. The exact same message id, POSTed twice (a Meta webhook retry), is
 *      deduped — no double-processing, no double reply
 *
 * Run: npm run simulate-webhook
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DRY_RUN_MESSAGES_FILE = path.join(REPO_ROOT, "scripts", "output", "messages.dry-run.jsonl");

const TEST_PORT = 8799;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "test-app-secret-for-simulation-only";
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "test-verify-token-for-simulation-only";
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sign(rawBody: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
}

function buildInboundTextPayload(messageId: string, from: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "TEST_WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "6580000000", phone_number_id: "TEST_PHONE_NUMBER_ID" },
              contacts: [{ profile: { name: "Test Enquirer" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function waitForHealth(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not become healthy in time");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Polls until `predicate` is true or times out. The webhook route acks
 * before the echo bot finishes processing (that's the point being tested),
 * so assertions on its side effects can't be pinned to a fixed sleep —
 * especially the first request after a cold tsx/module-load start, which
 * is visibly slower than steady-state. Poll, don't guess a delay.
 */
async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 15000, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function readDryRunMessages(): Promise<any[]> {
  try {
    const contents = await readFile(DRY_RUN_MESSAGES_FILE, "utf-8");
    return contents
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function main() {
  await rm(DRY_RUN_MESSAGES_FILE, { force: true });

  console.log(`Starting server on port ${TEST_PORT} (child process, dry-run mode: no Supabase/WhatsApp creds passed through)...`);
  // Spawn the local tsx binary directly rather than via `npx tsx` — npx's
  // own resolution step adds a second, highly variable process-spawn hop
  // that was the actual source of multi-second flakiness observed while
  // building this harness (server startup itself is fast; `npx` finding
  // and launching it was not).
  const tsxBin = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const child: ChildProcess = spawn(tsxBin, ["src/server.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
      // Deliberately NOT passing WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID or
      // SUPABASE_* here even if set in the parent shell's .env — this
      // simulation must prove the dry-run path, the same one anyone
      // without live credentials yet will actually be running.
      WHATSAPP_ACCESS_TOKEN: "",
      WHATSAPP_PHONE_NUMBER_ID: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitForHealth();
    console.log("Server is up.\n");

    console.log("Test 1: GET /webhook verification handshake");
    const goodChallenge = await fetch(
      `${BASE_URL}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    );
    check("correct verify_token -> 200 + echoes challenge", goodChallenge.status === 200 && (await goodChallenge.text()) === "12345");

    const badChallenge = await fetch(
      `${BASE_URL}/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=12345`,
    );
    check("wrong verify_token -> 403", badChallenge.status === 403);

    console.log("\nTest 2: POST /webhook rejects bad signature");
    const payload = buildInboundTextPayload("wamid.TEST_MSG_001", "6591234567", "hello, how much for a helper?");
    const rawBody = JSON.stringify(payload);
    const badSigRes = await fetch(`${BASE_URL}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=deadbeef" },
      body: rawBody,
    });
    check("invalid signature -> 401", badSigRes.status === 401);

    console.log("\nTest 3: POST /webhook with a valid signature — fast ack + echo reply");
    const t0 = Date.now();
    const goodSigRes = await fetch(`${BASE_URL}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(rawBody) },
      body: rawBody,
    });
    const ackMs = Date.now() - t0;
    check("valid signature -> 200 immediately", goodSigRes.status === 200);
    check(`ack was fast (${ackMs}ms) — proves it didn't wait on the reply send`, ackMs < 500);

    // Wait for the fire-and-forget processing to actually land — not a
    // fixed sleep (see waitUntil's doc comment above).
    const gotBothRows = await waitUntil(async () => {
      const rows = await readDryRunMessages();
      return (
        rows.some((r) => r.wa_message_id === "wamid.TEST_MSG_001" && r.direction === "inbound") &&
        rows.some((r) => r.direction === "outbound" && r.wa_to === "6591234567")
      );
    });
    let rows = await readDryRunMessages();
    check("inbound message persisted", gotBothRows && rows.some((r) => r.wa_message_id === "wamid.TEST_MSG_001" && r.direction === "inbound"));
    const outboundRow = rows.find((r) => r.direction === "outbound" && r.wa_to === "6591234567");
    check(
      "echo reply persisted with the same text back",
      !!outboundRow && outboundRow.text_body === "hello, how much for a helper?",
    );

    console.log("\nTest 4: same message id POSTed again (simulating a Meta webhook retry) — must dedupe");
    const retryRes = await fetch(`${BASE_URL}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(rawBody) },
      body: rawBody,
    });
    check("retry still acked 200 (Meta must never see an error for a dup)", retryRes.status === 200);
    // Dedupe means the retry produces NO new side effects at all, so there's
    // no positive condition to poll for here — give the (already-warm)
    // event loop a fixed beat to prove a negative, then assert.
    await sleep(1500);
    const rowsAfterRetry = await readDryRunMessages();
    check(
      "no duplicate rows were written for the retried message id",
      rowsAfterRetry.length === rows.length,
      `had ${rows.length} rows after first delivery, ${rowsAfterRetry.length} after retry`,
    );

    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    console.log(`Dry-run message log: ${path.relative(REPO_ROOT, DRY_RUN_MESSAGES_FILE)}`);
  } finally {
    child.kill();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
