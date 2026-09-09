-- Phase 4: conversation pause state, real escalation delivery, and a flag
-- for media that may contain an identity document.

create table if not exists conversations (
  conversation_id  text primary key,        -- the enquirer's WhatsApp id
  enquirer_name    text,                    -- from WhatsApp's contact profile, when Meta sends one
  bot_paused       boolean not null default false,
  paused_reason    text,
  updated_at       timestamptz not null default now()
);

-- Escalation is a real notification attempt, not just a row — status
-- tracks how (or whether) it actually reached the operator. 'undelivered'
-- must never be silent: the app also logs loudly to stderr whenever it
-- writes one (see src/escalation/escalate.ts).
create table if not exists escalations (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    text not null,
  enquirer_name      text,
  enquirer_number    text not null,
  reason             text not null,
  urgency            text not null check (urgency in ('low', 'medium', 'high')),
  summary            text not null,
  last_messages      jsonb not null,        -- verbatim, last 5 messages at time of escalation
  delivery_method    text not null check (delivery_method in ('freeform', 'template', 'none')),
  status             text not null check (status in ('sent', 'failed', 'undelivered')),
  error_detail       text,
  created_at         timestamptz not null default now()
);

-- Identity-document handling: flag, don't silently process. See
-- src/guardrails/hardTriggers.ts — every inbound image is treated as a
-- possible passport/NRIC photo and flagged, never forwarded to the model.
alter table messages add column if not exists media_redacted boolean not null default false;
alter table messages add column if not exists media_flagged_reason text;
