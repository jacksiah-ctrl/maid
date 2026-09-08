-- Phase 2: message log. Every inbound and outbound WhatsApp message is a
-- row here — it's the transcript Phase 3's agent loop reads from, and the
-- audit trail for "what did the bot say and when."

create table if not exists messages (
  id                 uuid primary key default gen_random_uuid(),

  wa_message_id      text unique,        -- Meta's message id; null for some
                                          -- outbound sends until the API
                                          -- response is recorded. UNIQUE is
                                          -- the dedupe mechanism for inbound
                                          -- webhook retries.
  direction          text not null check (direction in ('inbound', 'outbound')),
  wa_from            text not null,      -- E.164 WhatsApp ID, either side
  wa_to              text not null,

  conversation_id    text not null,      -- the enquirer's WhatsApp ID —
                                          -- the natural key for "this thread"
                                          -- until Phase 4 needs a richer
                                          -- conversations table

  message_type       text not null,      -- 'text' | 'image' | 'document' | 'audio' | 'video' | 'other'
  text_body          text,
  media_id           text,               -- Meta's media id, for text_type != 'text'
  media_storage_path text,               -- path in Supabase Storage once downloaded

  wa_timestamp       timestamptz,        -- timestamp Meta reported on the message
  raw_payload        jsonb,              -- full original webhook/send payload, for debugging

  created_at         timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on messages (conversation_id, created_at);
