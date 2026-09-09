-- Phase 3: tables the agent's tools write to.

create table if not exists leads (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        text not null,       -- the enquirer's WhatsApp id
  name                   text not null,
  requirements_summary   text not null,
  urgency                text not null check (urgency in ('low', 'medium', 'high')),
  created_at             timestamptz not null default now()
);

-- Calendar integration is stubbed (Phase 3 scope: prove the tool call and
-- persistence work; Phase 4+ can wire a real calendar). status stays
-- 'pending_confirmation' until a human actually confirms a slot.
create table if not exists appointments (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    text not null,
  preferred_slots    text[] not null,
  status             text not null default 'pending_confirmation'
                        check (status in ('pending_confirmation', 'confirmed', 'cancelled')),
  created_at         timestamptz not null default now()
);
