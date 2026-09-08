/** Minimal shape of a Meta WhatsApp Cloud API webhook POST body — only the
 * fields this project actually reads. See Meta's Cloud API webhook
 * reference for the full schema. */
export interface WhatsAppWebhookBody {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  field: string;
  value: {
    messaging_product: "whatsapp";
    metadata: { display_phone_number: string; phone_number_id: string };
    contacts?: Array<{ profile: { name?: string }; wa_id: string }>;
    messages?: WhatsAppInboundMessage[];
    statuses?: WhatsAppStatus[];
  };
}

export interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string; // unix seconds, as a string
  type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "location" | "contacts" | string;
  text?: { body: string };
  image?: WhatsAppMediaRef;
  document?: WhatsAppMediaRef & { filename?: string };
  audio?: WhatsAppMediaRef;
  video?: WhatsAppMediaRef;
}

export interface WhatsAppMediaRef {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}

export interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
}
