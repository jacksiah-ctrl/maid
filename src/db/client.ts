import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

let client: SupabaseClient | null = null;

/** Null when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY aren't set — callers must handle dry-run mode. */
export function getSupabase(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!client) {
    client = createClient(config.supabaseUrl!, config.supabaseServiceRoleKey!);
  }
  return client;
}
