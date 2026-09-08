# Best Home Employment Agency — sample invoice (redacted)

Transcribed from `Invoice-IVC032016 (1).pdf`, forwarded 4 Jul 2026 in the WhatsApp
thread, for the specific case: Indonesian FDW, first-time hire, agency handled a
**replacement application** (outgoing helper "Mbayung", incoming helper Lestari).

Employer name, NRIC, and the agency's PayNow/UEN banking details have been
redacted per PDPA — none of that is needed for fee-config purposes. Every line
item, amount, GST flag, and total below is verbatim from the source document and
is the only real fee data currently available for `config/fees.json`. Everything
not covered by this table is TODO_VERIFY — do not invent adjacent figures (e.g.
costs for other nationalities, transfer-only cases, or subsequent-hire discounts)
by extrapolating from this one invoice.

| # | Item | Charge (SGD) | Discount | GST | Taxable amount |
|---|------|--------------|----------|-----|-----------------|
| 1 | Agency service fee — Lestari, Baresi 1st timer | 1288.00 | 350.00 | Y | 938.00 |
| 2 | 1st full medical examination | 55.05 | 0.00 | Y | 55.05 |
| 3 | Settling-in Programme (SIP) | 70.09 | 0.00 | Y | 70.09 |
| 4 | Work permit application and e-issuance | 70.00 | 0.00 | N | 70.00 |
| 5 | In-transit transport | 183.49 | 0.00 | Y | 183.49 |
| 6 | Insurance plan — UOI Plus 2yrs | 540.00 | 0.00 | Y | 540.00 |
| 7 | Waiver of counter indemnity — UOI 2yrs | 50.00 | 0.00 | Y | 50.00 |
| 8 | Accommodation in EA dormitory | 96.33 | 0.00 | Y | 96.33 |
| 9 | 1-way airfare to Singapore | 137.61 | 0.00 | Y | 137.61 |
| 10 | Placement fee (from source) | 3300.00 | 0.00 | N | 3300.00 |
| 11 | Indonesia embassy contract | 70.00 | 0.00 | Y | 70.00 |

- Gross total: **$5,510.57**
- GST (9%): **$192.65**
- Nett total: **$5,703.22**

## Notes for fee-config extraction (Phase 3)

- This is a **first-timer Indonesian helper via a replacement application**, not
  a transfer (an in-Singapore helper switching employer). The thread never shows
  a transfer-case invoice — `calculate_cost`'s transfer-vs-new-helper split has
  only the "new helper" side backed by a real number. Transfer pricing is
  TODO_VERIFY.
- Salary figures live separately in the chat, not the invoice: Lestari
  $550 basic / $21.20 per off-day-worked (Sunday), Nurfitriana $600 basic /
  $23.10. These are two Indonesian-helper data points, not a nationality-wide
  salary table — do not generalize to "Filipino helpers cost X" etc.
- "Guarantee period": Jassey states **7 months, unlimited replacement within
  that window** — a verbal statement in chat, not written on the invoice. Flag
  as agency policy, not MOM policy, when it reaches the system prompt.
- Items 4 and 10 are not GST-taxable in this invoice; the rest are. If
  `calculate_cost` itemises GST, preserve this per-line split rather than
  applying a blanket 9% to everything.
