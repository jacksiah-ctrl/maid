# Eval harness

## What's here

- `golden-set.json` — 30 real enquiry openers, extracted verbatim (or
  lightly joined across a single rapid-fire burst — never across different
  points in the thread) from `seed/whatsapp-export.txt`. Every item cites
  its exact source line(s).
- `golden-set-supplement-synthetic.json` — 6 **synthetic** items, clearly
  separated and never merged into the 30-item pass rate. See "the coverage
  gap" below for why these exist.
- `reports/baseline.md` — the output of the most recent `npm run run-evals`.

## Run it

```bash
npm run run-evals
```

Without `ANTHROPIC_API_KEY`, every item that isn't resolved by a hard
trigger is honestly reported as `SKIPPED` — not estimated, not faked. See
the report's own header for exactly what ran and what didn't in a given
run. With a real key, every item actually calls the agent loop
(`src/agent/loop.ts`) and gets graded for real.

**Escalation delivery is always mocked**, regardless of what `.env` has
configured: `run-evals.ts` strips `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` from its own process before running anything,
so an `escalate_to_human` call during an eval can never reach a real phone
(`+6580372668`) or write into a real database — it falls into the same
dry-run logging path used throughout local development. This is a hard
requirement from the brief, not a convenience.

## What gets graded, per item

- **Answered** — did the model produce a non-empty reply.
- **Tool correctness** — for items with `allowed_tools` set, did it call
  at least one of them. Items with `allowed_tools: null` aren't graded on
  this axis (open-ended exchanges where tool use is genuinely optional).
- **Hallucination** — reuses the exact same check the live bot runs before
  every send (`src/guardrails/preSend.ts`): any `$` figure in the reply
  must match a number some tool call actually returned this turn, and any
  commitment-verb-near-a-date-token pattern is flagged. Running the
  production guardrail logic against eval replies means a flagged item
  here is the same signal that would have blocked that reply for real.
- **Escalation correctness** — did `escalate_to_human` get called (or did
  a hard trigger fire before the model even ran) exactly when the golden
  item says it should.

An item's overall `pass` requires: no hallucination flag, tool correctness
not `fail`, and escalation correctness. "Answered" is reported but doesn't
independently fail an item — a short, correct escalation handoff is a
perfectly good outcome even though it isn't a detailed answer.

## The coverage gap — read before trusting escalation numbers

The real transcript is one household's cooperative, satisfied hire — there
is **zero** complaint, payment/transfer mention, explicit "speak to a
human" request, or eligibility question anywhere in
`seed/whatsapp-export.txt`. That's documented back in
`docs/phase0-analysis.md`. Practically, it means:

- All 30 real golden-set items have `should_escalate` driven by process/
  eligibility/timeline questions (which need model judgment, not a
  keyword), never by a hard trigger.
- The hard-trigger keyword layer (`src/guardrails/hardTriggers.ts`) has no
  real-data positive examples to test against at all.

The synthetic supplement exists only to close that specific gap —
exercising the hard-trigger layer with invented (never claimed as real)
phrasing in the same conversational register. Building it caught a real
bug before it shipped: the original complaint keyword list matched
"unacceptable" but not "not acceptable" (two different substrings), which
`s02` exposed — fixed in `config/escalation-rules.json`. `s06` is kept
deliberately failing the keyword layer on purpose (phrasing like "this
whole process is a joke, waste of my time" has no clean keyword) to prove
honestly that the hard-trigger layer is a first line, not a complete one —
the model's own judgment (per the system prompt) is meant to be the second
line for exactly this kind of case, and that's what actually needs a real
API key to verify.

## Baseline discipline

Per the brief: **this runs before any system-prompt change**, and the
report is committed so a prompt edit's effect is visible against a real
prior state, not vibes. When you do have `ANTHROPIC_API_KEY` and change
`src/agent/system-prompt.md`, re-run `npm run run-evals` and diff the new
`reports/baseline.md` against the committed one before deciding the change
was actually an improvement.
