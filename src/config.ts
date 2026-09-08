import "dotenv/config";

/**
 * Central env access. Nothing here throws at import time — most of this
 * project needs to run in dry-run mode with zero credentials (see
 * scripts/ingest-biodata.ts for the pattern this follows). Each consumer
 * checks the specific vars it needs and fails loudly, at the point of use,
 * with a message naming exactly what's missing.
 */
export const config = {
  port: parseInt(process.env.PORT ?? "8787", 10),

  supabaseUrl: process.env.SUPABASE_URL ?? null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,

  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? null,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
    appSecret: process.env.WHATSAPP_APP_SECRET ?? null,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? "v21.0",
  },

  operatorWhatsAppNumber: process.env.OPERATOR_WHATSAPP_NUMBER ?? null,
};

export const hasSupabase = () => !!(config.supabaseUrl && config.supabaseServiceRoleKey);
export const hasWhatsAppCredentials = () =>
  !!(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
