import { readFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_PATH = path.resolve(process.cwd(), "config", "operator.json");

export interface OperatorConfig {
  operator_whatsapp_number: string;
  alert_template: { name: string; language_code: string };
}

let cached: OperatorConfig | null = null;
export async function loadOperatorConfig(): Promise<OperatorConfig> {
  if (cached) return cached;
  cached = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
  return cached!;
}
