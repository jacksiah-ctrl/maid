import { insertRow } from "./genericInsert.js";

export interface EscalationRecord {
  conversation_id: string;
  enquirer_name: string | null;
  enquirer_number: string;
  reason: string;
  urgency: "low" | "medium" | "high";
  summary: string;
  last_messages: unknown;
  delivery_method: "freeform" | "template" | "none";
  status: "sent" | "failed" | "undelivered";
  error_detail?: string | null;
}

export async function saveEscalation(record: EscalationRecord): Promise<void> {
  await insertRow("escalations", record);
}
