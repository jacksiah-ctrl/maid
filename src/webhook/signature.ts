import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the *raw*
 * request body, keyed with the app secret. Must run against the exact
 * bytes Meta sent — verifying against a re-serialized/parsed JSON object
 * will silently break the moment key order or whitespace differs, so the
 * server is wired to capture rawBody before JSON parsing (see server.ts).
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const providedHex = signatureHeader.slice("sha256=".length);

  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
