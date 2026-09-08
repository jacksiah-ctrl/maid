import Fastify from "fastify";
import { config } from "./config.js";
import { verifyWebhookSignature } from "./webhook/signature.js";
import { processWebhookBody } from "./webhook/receive.js";
import type { WhatsAppWebhookBody } from "./whatsapp/types.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const app = Fastify({ logger: true });

// Capture the exact raw bytes of the request body BEFORE JSON parsing.
// HMAC signature verification must run against these exact bytes — parsing
// then re-serializing can change whitespace/key order and silently break
// verification.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  req.rawBody = body as Buffer;
  try {
    const json = (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf-8")) : {};
    done(null, json);
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get("/health", async () => ({ ok: true }));

// --- Meta's one-time webhook verification handshake ---
// Meta calls this when you register/verify the webhook URL in the App
// Dashboard. Echo back hub.challenge only if the verify token matches what
// you configured there.
app.get("/webhook", async (req, reply) => {
  const query = req.query as Record<string, string>;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (!config.whatsapp.webhookVerifyToken) {
    req.log.error("WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set — cannot verify webhook handshake");
    return reply.code(500).send("server not configured");
  }

  if (mode === "subscribe" && token === config.whatsapp.webhookVerifyToken) {
    req.log.info("Webhook verification handshake succeeded");
    return reply.code(200).send(challenge);
  }
  req.log.warn({ mode, tokenMatched: token === config.whatsapp.webhookVerifyToken }, "Webhook verification handshake failed");
  return reply.code(403).send("verification failed");
});

// --- Inbound events ---
// Meta retries on anything other than a fast 200, so: verify signature,
// ack immediately, THEN process. Never await processWebhookBody before
// replying.
app.post("/webhook", async (req, reply) => {
  if (!config.whatsapp.appSecret) {
    req.log.error("WHATSAPP_APP_SECRET is not set — refusing to accept webhook POSTs (cannot verify signature)");
    return reply.code(500).send("server not configured");
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const rawBody = req.rawBody ?? Buffer.alloc(0);
  if (!verifyWebhookSignature(rawBody, signature, config.whatsapp.appSecret)) {
    req.log.warn("Webhook signature verification failed — rejecting");
    return reply.code(401).send("invalid signature");
  }

  // Ack first.
  reply.code(200).send("EVENT_RECEIVED");

  // Then process, off the request/response cycle. Errors are logged, not
  // thrown at Meta — a failure here must never turn into a 5xx that makes
  // Meta retry a webhook we've already 200'd.
  const body = req.body as WhatsAppWebhookBody;
  processWebhookBody(body).catch((err) => {
    req.log.error({ err }, "Error processing webhook body");
  });
});

async function start() {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
