# Phase 0 — Seed data analysis

Source: `seed/whatsapp-export.txt` (redacted), 345 lines, 29 Jun–2 Sep 2026,
between Jack ("You"), his wife Huey Ling, and Jassey Khoo (salesperson,
Best Home Employment Agency Pte Ltd). See `seed/README.md` for what this
data actually is and isn't — read that before this document, because it
changes how much weight to put on the frequency ranking below.

## 1. Representative inbound messages (verbatim)

These are Jack's FAQ-shaped questions — the closest analogue in this thread
to what a prospective employer would ask "the agency" cold over WhatsApp.

1. "the helpers: they normally don't work longer than three years? What's
   Lestari's reason for not continuing her current batam job?"
2. "@Jassey Khoo - how much is Lestari's salary?"
3. "Jassey, thanks a lot for Lestari — you got one more for comparison?"
4. "@Jassey Khoo - u think possible for us to find out what Lestari's
   previous employer would say about her? Did she have a reference letter?"
5. "how much is their monthly expected salary, and is it possible for us to
   chat with Lestari and Sulastri one last time this afternoon?"
6. "@Jassey Khoo we will go with Lestari — what's the paperwork we need to
   do and how much is your agency fees?"
7. "this one got guarantee period, and if yes for how long?"
8. "in-transit transport is cover lestari from where to where?"
9. "this eop i must redo for this new helper?"
10. "can i inform my existing agent to release work permit now? or better
    wait till ticket booked first?"
11. "hello Jassie, can we ask when Lestari will receive her Work Permit? She
    also mentioned she doesn't have a bank acc, shd we help her open? Her
    sim card - that's prepaid and she needs to reload every month isit?"
12. "before that, we can't go back to malaysia with her right? hahaha"

## 2. Question types, ranked by frequency

Ranked by distinct occurrences in this one thread. With n=1 conversation
this is indicative, not statistically representative — treat as a starting
taxonomy to validate against more transcripts, not a settled distribution.

1. **Candidate sourcing & comparison** (most frequent by raw count) —
   "you got one more for comparison?", requests to interview multiple
   candidates back-to-back, explicit side-by-side ("we've decided to
   compare sulastri, lestari and fitriani"). Every biodata Jassey forwards
   triggers a scheduling round.
2. **Cost & fee breakdown** — salary of a specific helper (asked twice, for
   two different candidates), total agency fee, what a specific line item
   ("in-transit transport") covers, whether a guarantee/replacement period
   exists and how long.
3. **Interview/appointment scheduling & rescheduling** — dominates raw
   message volume but is operational, not informational; a bot handling
   this needs `book_appointment`, not FAQ answers.
4. **MOM / work-permit process & timeline** — EOP redo requirement,
   SingPass authorisation step, fingerprinting logistics, "how long until
   the work permit card arrives," coordinating release of an existing
   helper's permit against a new helper's arrival date.
5. **Helper vetting / background** — reason for leaving last job, whether a
   reference letter or previous-employer feedback is obtainable, prior
   employment history read off the biodata.
6. **Post-placement practical logistics** — opening a bank account for the
   helper, prepaid SIM top-up, whether the employer can travel with the
   helper before her card is issued.

Gaps against the brief's expected FAQ list: this thread has **no
salary-by-nationality comparison** (only Indonesian candidates appear), **no
explicit off-day-expectations discussion** (the figure exists on the
biodata PDF — "1 rest day per month" — but nobody asks about it in chat),
and no direct "how long does placement take end-to-end" question (only
inferable from the ~2-month gap between first contact and collection day).
The Phase 5 golden set will need synthetic questions to cover these —
flagged now so it isn't a silent gap later.

## 3. Language mix and register

- **Base language**: English throughout, no full sentences in Mandarin or
  Malay. Malay/Indonesian appears only inside biodata content (place names,
  "Fresh"/"Ex Sing" candidate-status shorthand) and job-market jargon, not
  as a language the participants converse in.
- **Singlish markers** (Jack's side): "cannot", "tmr", "le" (Hokkien-derived
  discourse particle — "more than two years le", "then we decide lu"),
  "isit" ("she needs to reload every month isit?"), "shd", "cfm", "smth",
  dropped subjects ("old helper still at home", "night time cannot because
  current helper still around").
- **Jassey's register**: terse, fragment/keyword style, frequent typos and
  dropped words ("salary low, prefer come spore", "stanby", "seaching",
  "willissue", "tivcket"), business auto-reply used when offline: *"Leave a
  msg, I will try to get u back ASAP or can reach my office number at
  64627055."* This auto-reply is worth mirroring — it's the agency's own
  pattern for "I'm not immediately available, here's a fallback."
- **Formal register only appears once**: the structured intake form (NRIC,
  household composition, income declaration, residence type) is full
  formal English — this is a copy-pasted template Jassey sends verbatim,
  not something either side writes in their own words. The system prompt
  should treat this form as a document to hand off / collect, not draft
  conversationally.
- Net takeaway for the system prompt: default to short, direct Singlish-
  inflected English, not formal customer-service prose. The agency's real
  voice is closer to "salary low, prefer come spore" than to a scripted
  FAQ page.

## 4. Places the human gave information a bot must not give

| # | Quote | Category | Why the bot can't do this |
|---|-------|----------|---------------------------|
| 1 | "$550 basic salary / per sunday $21.20" | Price commitment | A specific candidate's negotiated salary quoted as settled fact. `search_helpers` can surface a stored `expected_salary` field, but a bot must never state a number as agreed/final. |
| 2 | "Nurfitriana basic salary $600 (per sunday $23.10)" | Price commitment | Same pattern for a second candidate — confirms this isn't a one-off, it's how the agency normally answers, and it's exactly the behavior the guardrail (`escalate_to_human` on unconfigured cost figures) exists to catch. |
| 3 | "within 7mths unlimitted [guarantee]" then "hopefully can last 2 yrs" | Timeline promise + outcome speculation | First half is a guarantee-period policy (arguably fine if it's in config); second half is Jassey's personal hope about how long the placement lasts — a bot must never speculate about placement outcomes. |
| 4 | "after finger print-MOM willissue her card, send out 7 to 14 days" | Timeline promise | Presented as MOM's fixed timing on the agency's own experience, not published MOM guidance. `check_eligibility_guidance` must frame timing as indicative and point to MOM, never assert a number as guaranteed. |
| 5 | "$2400 under jack, Mrs?" / "do ur declare taxes last year?" / "how long do ur work in spore?" → eop.com.sg | Eligibility ruling in progress | Jassey is live-assessing MOM income/employment criteria against Jack's specific finances. This is exactly what `check_eligibility_guidance` must never do — it returns published criteria as reference only, it does not evaluate a specific household against them. |
| 6 | "need ur authorisation by singpass-allow best home to apply ur application" | Immigration/process advice | Instructing a specific step in an official government application flow. This is CEI-personnel territory — a bot should hand this off, not walk a customer through it. |
| 7 | "Jassey, just checking whether 29 August is OK?" → "fetch, ready inform supplier-they will update once ticket booked" | Timeline promise | Coordinating a hard date for releasing one helper against booking another's flight — a real scheduling commitment a bot has no authority to make. |
| 8 | "before that, we can't go back to malaysia with her right? hahaha" — never actually answered | Immigration advice (gap) | Notable as a case where even the human agent dodged rather than rule on an immigration question. Good signal: when the real agency doesn't answer, the bot shouldn't guess either — escalate. |

Pattern across all eight: every instance where the human commits to a
number or a ruling is exactly the shape of thing `escalate_to_human` and the
pre-send dollar/date guardrail exist to intercept. None of these are edge
cases in the transcript — they're the default way Jassey operates.

## 5. What this means for scope going into Phase 1

- `config/fees.json` can be seeded from one real invoice
  (`seed/reference/best-home-invoice-sample.md`) — a first-timer Indonesian
  helper via replacement application. Everything outside that one scenario
  (other nationalities, straight transfers, subsequent-hire pricing) is
  TODO_VERIFY, not to be extrapolated.
- The `helpers` table will have exactly one real row until more biodata
  PDFs are supplied — Phase 1 proves the parser works, it does not stand up
  a usable `search_helpers` yet.
- The system prompt's FAQ answers will be thin on salary-by-nationality and
  off-day expectations — flagged as TODO_VERIFY / needs more source
  material rather than filled in from guesswork.
