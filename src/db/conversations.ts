import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSupabase } from "./client.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "scripts", "output");
const DRY_RUN_FILE = path.join(OUTPUT_DIR, "conversations.dry-run.json");

export interface ConversationRow {
  conversation_id: string;
  enquirer_name: string | null;
  bot_paused: boolean;
  paused_reason: string | null;
  updated_at: string;
}

type DryRunMap = Record<string, ConversationRow>;

// Unlike messages/leads/appointments (append-only logs), conversation state
// is mutated in place (bot_paused flips back and forth) — so the dry-run
// stand-in is a single JSON object keyed by conversation_id, rewritten on
// every update, not a JSONL append log.
async function loadDryRunMap(): Promise<DryRunMap> {
  try {
    return JSON.parse(await readFile(DRY_RUN_FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function saveDryRunMap(map: DryRunMap): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(DRY_RUN_FILE, JSON.stringify(map, null, 2));
}

export async function getConversation(conversationId: string): Promise<ConversationRow | null> {
  const supabase = getSupabase();
  if (!supabase) {
    const map = await loadDryRunMap();
    return map[conversationId] ?? null;
  }
  const { data, error } = await supabase.from("conversations").select("*").eq("conversation_id", conversationId).maybeSingle();
  if (error) throw new Error(`getConversation failed: ${error.message}`);
  return (data as ConversationRow) ?? null;
}

/** Merges `patch` into the conversation row, creating it if it doesn't exist yet. */
export async function upsertConversation(
  conversationId: string,
  patch: Partial<Omit<ConversationRow, "conversation_id" | "updated_at">>,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    const map = await loadDryRunMap();
    const existing = map[conversationId];
    map[conversationId] = {
      conversation_id: conversationId,
      enquirer_name: existing?.enquirer_name ?? null,
      bot_paused: existing?.bot_paused ?? false,
      paused_reason: existing?.paused_reason ?? null,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await saveDryRunMap(map);
    return;
  }
  const { error } = await supabase
    .from("conversations")
    .upsert({ conversation_id: conversationId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "conversation_id" });
  if (error) throw new Error(`upsertConversation failed: ${error.message}`);
}

export async function setBotPaused(conversationId: string, paused: boolean, reason: string | null = null): Promise<void> {
  await upsertConversation(conversationId, { bot_paused: paused, paused_reason: reason });
}

export async function isBotPaused(conversationId: string): Promise<boolean> {
  const row = await getConversation(conversationId);
  return row?.bot_paused ?? false;
}
