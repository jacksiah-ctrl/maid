import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "../db/client.js";

const DRY_RUN_MESSAGES_FILE = path.resolve(process.cwd(), "scripts", "output", "messages.dry-run.jsonl");

interface MessageRow {
  direction: "inbound" | "outbound";
  message_type: string;
  text_body: string | null;
  created_at: string;
  conversation_id: string;
}

async function loadRows(conversationId: string): Promise<MessageRow[]> {
  const supabase = getSupabase();
  if (!supabase) {
    let contents: string;
    try {
      contents = await readFile(DRY_RUN_MESSAGES_FILE, "utf-8");
    } catch {
      return [];
    }
    return contents
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as MessageRow)
      .filter((r) => r.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { data, error } = await supabase
    .from("messages")
    .select("direction, message_type, text_body, created_at, conversation_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`loading conversation history failed: ${error.message}`);
  return (data ?? []) as MessageRow[];
}

function describeNonText(messageType: string): string {
  return `[sent a ${messageType}]`;
}

/**
 * Loads the FULL conversation thread for one enquirer from the messages
 * table (or its dry-run stand-in) and converts it to Anthropic's message
 * format, on every turn — no in-memory conversation state is kept between
 * turns beyond the debounce timer bookkeeping (see scheduler.ts). This is
 * the brief's explicit design: "running the full conversation thread from
 * Postgres on every turn."
 *
 * Consecutive same-role rows (e.g. three rapid-fire inbound texts the
 * debounce coalesced into one turn) are left as separate MessageParam
 * entries — the API merges consecutive same-role messages itself, and
 * splitting them out preserves per-message boundaries as separate lines
 * rather than losing them in one concatenated blob.
 */
export async function loadConversationHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await loadRows(conversationId);
  return rows.map((row) => ({
    role: row.direction === "inbound" ? "user" : "assistant",
    content: row.message_type === "text" ? (row.text_body ?? "") : describeNonText(row.message_type),
  }));
}
