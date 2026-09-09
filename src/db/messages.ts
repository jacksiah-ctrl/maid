import { mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getSupabase } from "./client.js";

export interface MessageRecord {
  wa_message_id: string | null;
  direction: "inbound" | "outbound";
  wa_from: string;
  wa_to: string;
  conversation_id: string;
  message_type: "text" | "image" | "document" | "audio" | "video" | "other";
  text_body?: string | null;
  media_id?: string | null;
  media_storage_path?: string | null;
  media_redacted?: boolean;
  media_flagged_reason?: string | null;
  wa_timestamp?: string | null; // ISO
  raw_payload?: unknown;
}

export interface StoredMessage extends MessageRecord {
  created_at: string;
}

// --- Dry-run fallback: same pattern as scripts/ingest-biodata.ts. No
// Supabase creds -> append to a local JSONL file instead of Postgres, and
// dedupe against an in-memory set seeded from that file. This is enough to
// prove the webhook handler's logic (ack fast, dedupe, persist) without a
// live database, matching how Phase 1 was proven.
const OUTPUT_DIR = path.resolve(process.cwd(), "scripts", "output");
const DRY_RUN_FILE = path.join(OUTPUT_DIR, "messages.dry-run.jsonl");

let dryRunSeenIds: Set<string> | null = null;

async function loadDryRunSeenIds(): Promise<Set<string>> {
  if (dryRunSeenIds) return dryRunSeenIds;
  const seen = new Set<string>();
  if (existsSync(DRY_RUN_FILE)) {
    const contents = await readFile(DRY_RUN_FILE, "utf-8");
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.wa_message_id) seen.add(row.wa_message_id);
      } catch {
        // ignore malformed lines from a previous crashed run
      }
    }
  }
  dryRunSeenIds = seen;
  return seen;
}

export async function messageExists(waMessageId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    const seen = await loadDryRunSeenIds();
    return seen.has(waMessageId);
  }
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("wa_message_id", waMessageId)
    .maybeSingle();
  if (error) throw new Error(`messageExists query failed: ${error.message}`);
  return !!data;
}

export async function saveMessage(record: MessageRecord): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const seen = await loadDryRunSeenIds();
    await appendFile(DRY_RUN_FILE, JSON.stringify({ ...record, created_at: new Date().toISOString() }) + "\n");
    if (record.wa_message_id) seen.add(record.wa_message_id);
    return;
  }
  const { error } = await supabase.from("messages").insert(record);
  if (error) {
    // 23505 = unique_violation on wa_message_id — a race with another
    // webhook retry landing concurrently. Treat as already-saved, not a
    // failure: the whole point of the unique constraint is exactly this.
    if (error.code === "23505") return;
    throw new Error(`saveMessage insert failed: ${error.message}`);
  }
}

/** Last `limit` messages for a conversation, oldest first — used for escalation alerts and the no-progress guardrail. */
export async function getRecentMessages(conversationId: string, limit: number): Promise<StoredMessage[]> {
  const supabase = getSupabase();
  if (!supabase) {
    let contents: string;
    try {
      contents = await readFile(DRY_RUN_FILE, "utf-8");
    } catch {
      return [];
    }
    const rows = contents
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as StoredMessage)
      .filter((r) => r.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return rows.slice(-limit);
  }
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentMessages query failed: ${error.message}`);
  return ((data ?? []) as StoredMessage[]).reverse();
}
