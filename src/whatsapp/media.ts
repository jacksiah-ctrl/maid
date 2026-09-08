import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, hasWhatsAppCredentials, hasSupabase } from "../config.js";
import { getSupabase } from "../db/client.js";

const STORAGE_BUCKET = "media";
const LOCAL_MEDIA_DIR = path.resolve(process.cwd(), "scripts", "output", "media");

interface MediaUrlLookup {
  url: string;
  mime_type: string;
  file_size: number;
  id: string;
}

/**
 * The Cloud API's two-step media fetch: (1) GET the media id to get a
 * short-lived signed URL, (2) GET that URL (still with your bearer token)
 * to get the bytes. The URL from step 1 expires in minutes — never cache it.
 */
async function fetchMediaUrl(mediaId: string): Promise<MediaUrlLookup> {
  const res = await fetch(`https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  });
  if (!res.ok) throw new Error(`Media URL lookup failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as MediaUrlLookup;
}

async function fetchMediaBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` } });
  if (!res.ok) throw new Error(`Media download failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
  };
  return map[mimeType] ?? "bin";
}

/**
 * Downloads a media object referenced in an inbound message and stores it,
 * returning the storage path to persist on the message row.
 *
 * Without WHATSAPP_ACCESS_TOKEN set, this can't actually reach the Graph
 * API — it logs that and returns null rather than throwing, so the webhook
 * handler still completes and persists the message (just without a media
 * path) in dry-run mode.
 */
export async function downloadAndStoreMedia(mediaId: string, waMessageId: string): Promise<string | null> {
  if (!hasWhatsAppCredentials()) {
    console.log(`[dry-run] would download + store media ${mediaId} (message ${waMessageId})`);
    return null;
  }

  const { url, mime_type } = await fetchMediaUrl(mediaId);
  const bytes = await fetchMediaBytes(url);
  const filename = `${waMessageId}.${extensionFor(mime_type)}`;

  if (!hasSupabase()) {
    await mkdir(LOCAL_MEDIA_DIR, { recursive: true });
    const localPath = path.join(LOCAL_MEDIA_DIR, filename);
    await writeFile(localPath, bytes);
    console.log(`[dry-run] no Supabase configured — saved media locally to ${localPath}`);
    return `local:${localPath}`;
  }

  const supabase = getSupabase()!;
  const storagePath = `${waMessageId}/${filename}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
    contentType: mime_type,
    upsert: true,
  });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  return storagePath;
}
