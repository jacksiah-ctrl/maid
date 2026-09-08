-- Phase 1: helper inventory tables.
-- Plain SQL, run directly against Supabase Postgres (SQL editor or `psql`).
-- No ORM, no migration framework — apply these files in order by filename.

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- One row per successfully parsed biodata PDF. Absent fields are NULL, never
-- guessed — a NULL here means "not present in the source document", not
-- "extraction failed" (extraction failures on scanned PDFs go to
-- needs_manual_review instead, and the row is never created).
create table if not exists helpers (
  id                      uuid primary key default gen_random_uuid(),

  name                    text not null,
  nationality             text,
  date_of_birth           date,
  age                     integer,
  marital_status          text,
  num_children            integer,

  years_experience        numeric,          -- summed from the employment-history table
  prior_work_placements   text[],           -- literal locations from the biodata's employment history
                                             -- (often within-Indonesia placements, e.g. "JAKARTA", "BATAM" —
                                             -- NOT necessarily overseas countries; do not assume international
                                             -- experience just because this array is non-empty)

  skills                  jsonb,            -- {infant_care, elderly_care, handicap_care, general_housework,
                                             --  cooking, pets: boolean|null, ...}
  languages               text[],

  expected_salary_monthly numeric,          -- rarely on the biodata sheet itself; usually negotiated
                                             -- separately (see seed/whatsapp-export.txt) — null is the norm
  off_day_expectation     text,             -- e.g. "1 rest day per month", verbatim from the form
  rest_day_arrangement    text,             -- compensation-in-lieu terms, when stated (rare)
  availability_status     text,             -- almost always NULL: the biodata form's availability section is a
                                             -- checkbox group and text extraction cannot tell which box is ticked

  source_pdf_path         text not null,
  raw_text                text,             -- full reconstructed extraction, kept for debugging/re-extraction
  notes                   text,             -- free-text remarks captured verbatim from the PDF, plus a note on
                                             -- any inferred (not directly-labeled) fields such as pets from
                                             -- employment-history duties rather than the skills checkbox table

  created_at              timestamptz not null default now()
);

comment on column helpers.prior_work_placements is
  'Literal place names from the employment-history table. Do not treat as international "countries" without checking — most FDW biodata sheets list domestic placements (e.g. within Indonesia) for first-time-to-Singapore candidates.';

-- One row per biodata PDF that could not be parsed as text (typically a
-- scanned image with no text layer). Never guessed at — a human reviews these.
create table if not exists needs_manual_review (
  id              uuid primary key default gen_random_uuid(),
  source_pdf_path text not null,
  reason          text not null,      -- e.g. 'no extractable text (likely scanned)'
  text_length     integer,            -- length of whatever text WAS extracted, for triage
  created_at      timestamptz not null default now()
);
