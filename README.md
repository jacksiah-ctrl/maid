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
- [x] **Phase 2** — WhatsApp transport
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

## Phase 2 — WhatsApp transport

A Fastify server (`src/server.ts`) with the Cloud API webhook contract:
`GET /webhook` for Meta's one-time verification handshake, `POST /webhook`
for inbound events — signature-verified, acked in milliseconds, processed
after. `src/webhook/receive.ts` is an **echo bot**: text in, same text back
out; images/documents are downloaded via the two-step media flow and
acknowledged. Every inbound and outbound message is persisted to the
`messages` table (or its dry-run JSONL stand-in — same pattern as Phase 1).
This whole phase is deliberately dumb — no model, no FAQ logic — it exists
to prove the pipe works before Phase 3 puts an agent behind it.

**Database**: apply `db/migrations/0002_messages.sql` (in order, after
`0001_init.sql`).

**Run the server**:

```bash
npm run dev:server     # tsx watch, restarts on file changes
# or
npm run start:server
```

Without `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` set, outbound
sends and media downloads log `[dry-run] would send/download ...` instead
of calling the Graph API. Without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`,
messages persist to `scripts/output/messages.dry-run.jsonl` instead of
Postgres. `WHATSAPP_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` **are**
required to start handling webhook traffic at all — without them the server
refuses POSTs/verification with a 500 and a loud log line, rather than
silently skipping signature checks.

### What was actually proven in this sandbox, and what wasn't

This container has no stable public URL and no ngrok/Meta credentials, so
the brief's literal proof — "echo bot working on a real number over
ngrok" — could not be run here. What **was** proven, deterministically,
with real HTTP requests against the real server code (not mocks):

```bash
npm run simulate-webhook
```

This spawns the actual Fastify server as a child process and drives it
with signed, realistic Cloud API payloads to check: the verification
handshake (right token / wrong token), signature rejection on a bad HMAC,
a valid signed POST getting a **fast** 200 (measured — proves the handler
truly acks before processing, not just eventually), the echo reply and
both message rows landing in the dry-run log, and — the one most worth
watching — the exact same message id POSTed twice (simulating a Meta
webhook retry) producing **no duplicate rows**. All 9 checks pass; see the
output of that command for the live run.

### What you need to do to get the real proof (a live number over ngrok)

1. **Meta app**: developers.facebook.com → My Apps → Create App → type
   "Business" → add the **WhatsApp** product. This gives you a test number
   for free, a temporary access token, and a phone number ID — enough to
   send/receive without owning a real WhatsApp Business number yet.
2. Copy `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from the
   WhatsApp → API Setup page into `.env`.
3. Generate your own values for `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (any random
   string you pick) and note where to find `WHATSAPP_APP_SECRET` (App
   Settings → Basic → App Secret) — both into `.env`.
4. Run `npm run dev:server` locally.
5. In a second terminal: `ngrok http 8787` (install from ngrok.com if
   needed) — it prints a public `https://....ngrok-free.app` URL tunneled
   to your local server.
6. In the Meta App Dashboard → WhatsApp → Configuration → Webhook: set the
   callback URL to `https://<your-ngrok-domain>/webhook` and the verify
   token to whatever you put in `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Click
   Verify and Save — this is the `GET /webhook` handshake firing for real.
   Subscribe to the `messages` field.
7. From your own phone, WhatsApp the test number Meta gave you. You should
   see it logged by the running server and get the same text echoed back
   within a second or two — that's the real end-to-end proof.

**What's stubbed**: no real send/receive happened in this sandbox — steps
1–7 above are yours to run. `messages.wa_to`/`wa_from` use the phone number
ID rather than a resolved display number (fine for a prototype; cosmetic).
Delivery/read-receipt status callbacks (`value.statuses` in the webhook
payload) are received but intentionally not persisted yet — nothing reads
them until there's a reason to (e.g. an operator-alert delivery check in
Phase 4).

**Biggest thing that will break first in real use**: the 24-hour customer
service window. This phase's `sendText` only works for free-form replies —
there's no template fallback yet (that's explicitly Phase 4, for the
operator-alert channel specifically). The moment this server needs to
message someone outside a 24h-old inbound message, `sendText` will get a
real Graph API error back and currently just throws — Phase 3/4 need to
decide what "the bot's reply itself hit the 24h window" should do (in
practice: rare, since it only replies to messages that just arrived, but
worth stating rather than discovering live).
