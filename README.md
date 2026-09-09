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
- [x] **Phase 3** — agent loop
- [x] **Phase 4** — guardrails & operator handoff
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
after. `src/webhook/receive.ts` was originally an **echo bot** (text in,
same text back out) to prove the pipe worked with no model behind it yet —
Phase 3 has since replaced the reply logic with the real agent loop; what
Phase 2 actually still owns is dedupe, persistence, and the two-step media
download. Every inbound and outbound message is persisted to the
`messages` table (or its dry-run JSONL stand-in — same pattern as Phase 1).

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
truly acks before processing, not just eventually), the inbound message
landing in the dry-run log, the exact same message id POSTed twice
(simulating a Meta webhook retry) producing **no duplicate rows**, and —
added once Phase 3 wired the agent in behind this — that the server stays
healthy after the 4s debounce fires and the agent call fails closed (no
`ANTHROPIC_API_KEY` here) rather than taking the process down. All 9
checks pass; see the output of that command for the live run. As of Phase
3 this harness no longer asserts a reply's *content* — replying now runs
through a real model call, which it deliberately doesn't fake; see
`npm run simulate-agent` below for that.

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
   see it logged by the running server and get a real reply back within a
   few seconds (the agent loop, as of Phase 3 — not an echo anymore; also
   set `ANTHROPIC_API_KEY` in `.env` first, see Phase 3 below) — that's the
   real end-to-end proof.

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

## Phase 3 — agent loop

An actual model behind the transport, replacing Phase 2's echo bot.
`src/agent/loop.ts` is a manual Anthropic tool-use loop (not the SDK's beta
tool runner — Phase 4's guardrails need to see and gate every tool call and
candidate reply, and owning the loop keeps that in one obvious place for a
prototype this size). `src/agent/scheduler.ts` debounces inbound messages
per conversation by 4 seconds (a burst of rapid-fire texts collapses into
one turn, fired 4s after the last message) and, on firing, reloads the
**full** conversation thread from the `messages` table fresh — no
in-memory chat state persists between turns, per the brief.

Six tools, matching the brief exactly (`src/agent/tools/`):
`search_helpers`, `calculate_cost`, `check_eligibility_guidance`,
`create_lead`, `book_appointment`, `escalate_to_human` (this last one is an
explicit **stub** — logs loudly, doesn't send anything real; the brief
scopes real delivery to Phase 4). The system prompt is
`src/agent/system-prompt.md` — a standalone editable file, not inline in
code, written from `docs/phase0-analysis.md`'s findings including the
agency's real register (Singlish-inflected, terse) and the 8 documented
places a human gave information a bot must not repeat.

**The one rule the whole prompt is built around**: every dollar figure,
timeline, or eligibility statement has to come from a tool call in that
turn, never from the model's memory. `config/fees.json` is the only source
`calculate_cost` reads from, and it's honest about its gaps — only the
Indonesian/new-helper combination is populated (the one real invoice in
the seed data); everything else (transfer pricing, other nationalities,
the MOM levy, MOM eligibility criteria) is `null` + `status: "TODO_VERIFY"`,
and the tools are built to say so rather than estimate. **You need to fill
in `TODO_AGENCY_NAME` and the EA license number at the top of
`system-prompt.md`, and the whole of `config/mom-eligibility-reference.json`,
before this talks to a real customer** — both are placeholder-only by
design, since nothing in the seed data verifies either.

**Database**: apply `db/migrations/0003_agent_tables.sql` (adds `leads`,
`appointments`).

**Run the server** exactly as in Phase 2 (`npm run dev:server`), plus set
`ANTHROPIC_API_KEY` in `.env`. Optional: `ANTHROPIC_MODEL` (defaults to
`claude-opus-5`) and `ANTHROPIC_EFFORT` (defaults to `medium` — chat + tool
use doesn't need the higher effort levels tuned for hard reasoning; re-tune
against the Phase 5 eval once it exists, don't hand-tune from vibes).

### What was actually proven in this sandbox, and what wasn't

No `ANTHROPIC_API_KEY` is available in this sandbox (checked via `ant auth
status` and a live `messages.create` call — both confirm no credential is
resolvable here), so the model itself was never actually called while
building this. What **was** proven:

```bash
npm run simulate-agent
```

Part 1 (always runs, no API key needed) unit-tests all six tools directly
— including asserting `calculate_cost`'s math reproduces the real invoice
**exactly** ($5,510.57 subtotal → $192.65 GST → $5,703.22 total, matching
`seed/reference/best-home-invoice-sample.md` to the cent), that
`not_on_file` comes back honestly for every unpopulated combination
(transfer pricing, non-Indonesian nationalities) instead of an estimate,
that `search_helpers`' filters fail-safe on unknown fields rather than
guessing a match, and that `create_lead`/`book_appointment` persist
correctly. All these pass deterministically. Part 2 (a live-model smoke
test against three real openers from the golden quotes) only runs if
`ANTHROPIC_API_KEY` is set — it's explicitly not a graded eval, just a
"does this actually work" check for a human to read.

`npm run simulate-webhook` (Phase 2's harness) was re-run and updated:
Phase 3 changed what happens on an inbound message, so its old "echo reply
persisted with the same text" assertion no longer applies — it now checks
instead that the debounced hand-off to the agent doesn't crash the server
even when the model call fails (which it does here, for lack of a key).
All 9 of its checks still pass.

### What you need to do to get the real proof

1. Set `ANTHROPIC_API_KEY` in `.env` (or run with it in the environment).
2. `npm run simulate-agent` — Part 2 will now actually run and print three
   real replies for you to read.
3. For the full live loop: follow Phase 2's ngrok steps, then WhatsApp the
   test number a real enquiry (e.g. "how much for an Indonesian helper?")
   and watch the server logs — each tool call is printed as
   `[agent tool] <name>(<input>) -> <result>` — before the reply arrives.

**What's stubbed**: `escalate_to_human` logs to the server console only —
no real WhatsApp alert, no conversation pause (both are explicitly Phase 4).
`book_appointment`'s calendar integration is a placeholder row, not a real
calendar. Debounce state lives in server memory (a restart mid-debounce
just means the pending burst gets picked up as history on the next
message, rather than firing on its own — documented, not silently
ignored). Image/document messages are handed to the model as a bare
`[sent a document]` placeholder with no identity-document detection or
redaction yet — that's a Phase 4 hard-escalation trigger, not implemented
here.

**Biggest thing that will break first in real use**: `config/fees.json`
and `config/mom-eligibility-reference.json` are both mostly TODO_VERIFY by
design — the moment a real customer asks about a Filipino helper, a
transfer case, or any MOM eligibility specifics, the bot will correctly
say "I don't have that verified yet" and try to escalate. That's the
intended safe behavior, not a bug, but it means this bot is genuinely only
useful for the one scenario the seed data actually covers until someone
fills in the rest of the config.

## Phase 4 — guardrails and operator handoff

Escalation is now a real notification attempt, not just a database row.
`src/escalation/escalate.ts` is the single place this happens: it pauses
the conversation (`conversations.bot_paused`), tries a free-form WhatsApp
alert to the operator (`+6580372668`, `config/operator.json`), falls back
to an approved template if that fails, and — if **both** fail — logs a
loud, impossible-to-miss block to stderr and records `status=undelivered`
in the `escalations` table. That failure mode is treated as the worst one
in this system, per the brief, and is proven to actually behave that way
(see below), not just documented as an intention.

**Hard triggers** (`src/guardrails/hardTriggers.ts`) fire before the
message ever reaches the model: an explicit request for a human, a
complaint, a payment/transfer mention (keyword lists in
`config/escalation-rules.json`, edit freely), and — scoped to images only,
not PDFs, see the code comment for why — anything that might be a
passport/NRIC photo. A flagged image is downloaded and stored (the agency
may legitimately need it for the actual MOM application) but marked
`media_redacted=true` and **never** turned into model input; a text
placeholder update in Phase 3 already meant images were never sent to the
model, Phase 4 adds the explicit flag and the automatic escalation.

**Pre-send guardrail** (`src/guardrails/preSend.ts`): every draft reply is
checked before it goes out. Any `$` figure in the text must exactly match
a number some tool call actually returned this turn, or the reply is
blocked. Any commitment-verb-near-a-date-token pattern ("will be ready by
Monday", "guaranteed within 10 days") is blocked too. Both are regex
heuristics, not an NLP judge — deliberately over-cautious; a blocked reply
triggers a real escalation and a safe fallback message instead of just
silently retrying.

**No-progress guardrail** (`src/guardrails/noProgress.ts`): if the last 3
consecutive bot replies in a conversation made zero tool calls, the next
turn escalates instead of running the model a 4th time.

**Operator commands**: reply to the alert in WhatsApp with `resume
<number>` or `take <number>` (handled in
`src/escalation/operatorCommands.ts`, triggered when an inbound message's
sender matches `config/operator.json`'s number) — or run the CLI
equivalent: `npm run toggle-pause -- resume 6591234567` /
`... -- take 6591234567` / `... -- status 6591234567`.

**Database**: apply `db/migrations/0004_guardrails.sql` (adds
`conversations`, `escalations`, and two columns on `messages`).

### The escalation template — submission steps

The free-form alert only works within WhatsApp's 24h customer-service
window (i.e. the operator messaged the bot's number in the last 24h). For
outside that window, you need an **approved message template** submitted
in the Meta App Dashboard:

1. Meta App Dashboard → WhatsApp → Message Templates → Create Template.
2. Category: **Utility** (this is an operational alert, not marketing —
   utility templates have a much faster/more reliable approval path).
3. Name it exactly `escalation_alert` (matches `config/operator.json`'s
   `alert_template.name` — change both together if you rename it).
4. Language: English.
5. Body text (three variables, in this order — matches
   `alert_template.body_params_order` in `config/operator.json`):
   ```
   New enquiry escalation. From: {{1}}. Reason: {{2}}. Summary: {{3}}. Reply resume <number> or take <number>.
   ```
6. Submit for review. Meta typically approves utility templates within
   minutes to a few hours; you'll get a dashboard notification either way.
7. Once approved, no code or config change is needed — `escalate.ts`
   already reads the template name from `config/operator.json` and will
   start succeeding on the fallback path instead of hitting the
   loud-failure log.

**Until this is approved, the template fallback will fail** — correctly,
loudly, and by design (see "what was actually proven" below). That's not
a bug to work around before shipping; it's the intended fail-safe state
until you've actually done this Meta-side step.

### What was actually proven in this sandbox, and what wasn't

No live WhatsApp credentials exist here (same as Phases 2–3), so no real
alert reached a real phone. What **was** proven, deterministically:

```bash
npm run simulate-guardrails
```

18 checks, all passing: the three hard-trigger keyword categories fire
(and ordinary FAQ text doesn't), identity-document scoping is image-only,
the pre-send guardrail blocks an unapproved dollar figure and a date
commitment while allowing a tool-approved figure and non-committal
scheduling language through, the no-progress guardrail fires at exactly
the threshold, and — the one that matters most — `escalate()`'s full
three-way delivery outcome: free-form succeeds; free-form fails and the
template rescues it; **both fail and it's logged loudly, with
`status=undelivered` recorded**, never silent. That last path is only
testable via dependency injection (`escalate()` takes an optional `deps`
param — see its doc comment) since neither a real free-form send nor a
real template send is reachable without live credentials; the injection
point exercises the exact same code path a real double-failure would hit.
Operator `resume`/`take` parsing is proven too, including that
unrecognized text from the operator's own number is silently ignored
rather than erroring.

`npm run simulate-agent`'s tool tests were also updated: `escalate_to_human`
now asserts the conversation actually gets paused and an `escalations` row
is written, instead of Phase 3's "it's a stub" check.

### What you need to do to get the real proof

1. Get real WhatsApp credentials working (Phase 2's ngrok steps).
2. Submit the `escalation_alert` template (steps above) and wait for
   approval.
3. From a test enquirer number, trigger a hard escalation (e.g. send "can
   I speak to a human") and confirm `+6580372668` receives the alert.
4. Reply from the operator number with `resume <the enquirer's number>`
   and confirm the bot starts responding to that enquirer again.
5. Test the failure path deliberately: escalate while the operator hasn't
   messaged the bot in 24h (free-form should fail) with the template not
   yet approved (template should also fail) — confirm the loud stderr
   block appears and `escalations.status = 'undelivered'`.

**What's stubbed**: `book_appointment` calendar integration is still a
placeholder row (unchanged from Phase 3). The no-progress guardrail counts
tool-call presence/absence as its only signal for "progress" — a
reasonable proxy, not a semantic judgment of whether the conversation is
actually going anywhere. Debounce and pause state both live in server
memory/the dry-run JSON file — fine for a single-process prototype, not
for multiple server instances.

**Biggest thing that will break first in real use**: the pre-send
guardrail's date-commitment regex is a blunt instrument. It's tuned to
avoid firing on "noted your preference for tomorrow" (no false positive)
but will still over-trigger on some legitimate non-committal phrasing the
model produces in the wild — every over-trigger means a real reply gets
swapped for a generic fallback and an escalation gets created that a human
didn't need to see. Watch the `escalations` table's volume and reasons
once this runs against real traffic; a flood of `"Pre-send guardrail
blocked..."` entries means the regex needs tightening, not that the
system is broken.
