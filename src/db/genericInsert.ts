import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { getSupabase } from "./client.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "scripts", "output");

/**
 * Shared dry-run-or-Supabase insert for tables that don't need dedupe
 * (unlike messages.ts, which has its own version for the wa_message_id
 * unique-constraint case). Dry-run rows append to
 * scripts/output/<table>.dry-run.jsonl.
 */
export async function insertRow<T extends object>(table: string, row: T): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const file = path.join(OUTPUT_DIR, `${table}.dry-run.jsonl`);
    await appendFile(file, JSON.stringify({ ...row, created_at: new Date().toISOString() }) + "\n");
    return;
  }
  const { error } = await supabase.from(table).insert(row);
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
}
