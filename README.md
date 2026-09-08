# MDW WhatsApp agent — prototype

A working prototype: a WhatsApp bot that fields inbound enquiries for a
Singapore migrant domestic worker (MDW) placement agency, backed by real
helper biodata and a real fee structure, with a human operator in the loop
for anything it shouldn't decide on its own.

Built in phases; each phase is independently working and committed. See
`docs/phase0-analysis.md` for the seed-data analysis this project is built
from, and `seed/README.md` for what the seed data actually is (read that
one — it's not what it might look like from the file names).

## Status

- [x] **Phase 0** — seed data (redacted) + written analysis
- [x] **Phase 1** — biodata ingestion
- [ ] Phase 2 — WhatsApp transport
- [ ] Phase 3 — agent loop
- [ ] Phase 4 — guardrails & operator handoff
- [ ] Phase 5 — eval harness

## Setup

```bash
npm install
cp .env.example .env   # fill in as each phase needs its vars
```

Requires Node 20+. Uses `tsx` to run TypeScript scripts directly (no build
step needed for scripts).

## Phase 1 — biodata ingestion

Parses `seed/biodata/*.pdf` into a `helpers` table (Postgres/Supabase);
PDFs with no extractable text (scanned/image-only) go to
`needs_manual_review` instead of being guessed at.

**Database**: apply `db/migrations/0001_init.sql` to your Supabase project
(SQL editor, or `psql "$SUPABASE_DB_URL" -f db/migrations/0001_init.sql`).

**Run it**:

```bash
npm run ingest-biodata
```

If `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` aren't set in `.env`, the
script runs in **dry-run mode** automatically — it still does the full PDF
parse and prints the hit-rate report, but writes records to
`scripts/output/*.dry-run.json` instead of Postgres. That's the mode this
repo was built and proven in (no live Supabase project was available while
building it) — point it at a real project by filling in those two env vars
and re-running; nothing else changes.

To force dry-run even with credentials set (e.g. to sanity-check a new
biodata PDF before writing it): `npm run ingest-biodata -- --dry-run`.
To parse a different directory: `npm run ingest-biodata -- --dir some/path`.

**What to test manually**: run `npm run ingest-biodata`, read the printed
report (also written to `scripts/output/ingest-report.md`), and open
`scripts/output/helpers.dry-run.json` — check that the one real record
(Lestari) looks right against `seed/biodata/LESTARI.pdf` open side by side.

**What's stubbed / thin right now**:
- Only one biodata PDF exists in `seed/biodata/`, so the hit-rate report is
  n=1. It proves the parser works on this MOM/CEA form template; it does
  not prove coverage of other agencies' layouts. Add more PDFs to
  `seed/biodata/` and re-run to widen the sample.
- The field extractor is regex-based against one specific form template.
  A differently-laid-out biodata sheet will likely under-extract rather
  than crash — check the hit-rate report after adding new PDFs rather than
  assuming it generalizes.
- No live Supabase project is wired up yet — dry-run JSON output stands in
  for it. `search_helpers` (Phase 3) has nothing to query against until a
  real Supabase project exists and this script has been pointed at it with
  more than one helper record.

**Biggest thing that will break first in real use**: a biodata PDF from a
different source agency, or a different template revision from the same
one. The parser is built and tuned against exactly one document's layout;
the moment a differently-structured form shows up, expect a lower hit rate
(not a crash — every extractor fails closed to `null`) and check the report
before trusting the new rows.

### The pdf-parse spacing bug (worth knowing about)

The one real biodata PDF in this repo (a WPS-Docs-generated export) has no
actual space characters in its content stream — words are visually
separated only by glyph positioning, which `pdf-parse`'s default text
extraction doesn't reconstruct (you get
`BIO-DATAOFFOREIGNDOMESTICWORKER`). `scripts/ingest-biodata.ts` fixes this
with a custom `pagerender` hook that reads pdf.js's character-level text
items and reinserts spaces/line breaks from the gaps between glyphs — the
same thing poppler's `pdftotext` does internally. Still `pdf-parse` (same
dependency, per the brief), just with the render hook that makes its output
usable. See the comment at the top of the script if you need to retune the
gap thresholds for a new PDF that comes out mangled.
