# Seed data — provenance and caveats

## What's here

- `whatsapp-export.txt` — real WhatsApp export, 29 Jun–2 Sep 2026, redacted.
- `biodata/LESTARI.pdf` — one real helper biodata sheet (MOM/CEA standard form),
  text-based PDF, forwarded in the thread on 29 Jun 2026.
- `reference/best-home-invoice-sample.md` — redacted transcription of the one
  real invoice in the thread, kept for `config/fees.json` sourcing.

## What this data actually is (read before mining it for FAQs)

This is **not** an agency's export of inbound enquiries from many prospective
employers. It is a single, real conversation running in the *opposite*
direction: Jack (the user building this project) as a customer, buying one
helper (Lestari) from **Best Home Employment Agency Pte Ltd** (Lic. 96C5039),
via their salesperson Jassey Khoo. Per Jack's direction this is being used as
the ground-truth source for "the business" in the brief anyway — Jassey's
answers stand in for "how the agency currently answers." But the Phase 0
analysis has to be honest that:

- It's one household, one case, not a corpus — frequency-ranking questions
  from an n=1 thread is indicative at best, not statistically representative
  of "the 10-15 questions that repeat."
- Most of the thread is scheduling/logistics noise (interview times, fetch
  times, MOM appointment coordination), not FAQ content. The FAQ-relevant
  turns are a minority of the 345 lines.
- Only one biodata PDF exists here (Lestari's own), not an inventory. Phase 1
  will run against just this file; `search_helpers` has nothing to search
  until more biodata is added to `biodata/`.

## Redactions applied (PDPA)

Removed from `whatsapp-export.txt`: employer full name, both NRICs, both dates
of birth, home address, personal email, phone number, and the specific salary/
income figures disclosed during the income-declaration step (these were
Jack and Huey Ling's personal income, not a helper salary or agency fee — those
stay unredacted since they're the actual FAQ content this project needs).
Removed from the invoice transcription: employer name, NRIC, and Best Home's
PayNow/UEN banking details. Every dollar figure describing agency fees, helper
salary, or service line items is kept verbatim — that's the real data this
project runs on.
