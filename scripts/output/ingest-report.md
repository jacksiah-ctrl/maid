# Biodata ingestion report

Run: 2026-09-09T01:16:42.899Z
Source directory: `seed/biodata`
Mode: dry run (no Supabase credentials)

PDFs processed: 1
Parsed into `helpers`: 1
Flagged into `needs_manual_review`: 0

## Per-field extraction hit rate (across parsed PDFs)

| Field | Hits | Total | Rate |
|---|---|---|---|
| name | 1 | 1 | 100% |
| nationality | 1 | 1 | 100% |
| date_of_birth | 1 | 1 | 100% |
| age | 1 | 1 | 100% |
| marital_status | 1 | 1 | 100% |
| num_children | 1 | 1 | 100% |
| years_experience | 1 | 1 | 100% |
| prior_work_placements | 1 | 1 | 100% |
| skills.infant_care | 1 | 1 | 100% |
| skills.elderly_care | 1 | 1 | 100% |
| skills.handicap_care | 1 | 1 | 100% |
| skills.general_housework | 1 | 1 | 100% |
| skills.cooking | 1 | 1 | 100% |
| skills.pets | 1 | 1 | 100% |
| languages | 1 | 1 | 100% |
| expected_salary_monthly | 0 | 1 | 0% |
| off_day_expectation | 1 | 1 | 100% |
| rest_day_arrangement | 0 | 1 | 0% |
| availability_status | 0 | 1 | 0% |

**Sample size caveat**: this run processed the single biodata PDF currently in `seed/biodata/`. A hit rate from n=1 tells you the parser works on one real MOM/CEA-template form — it does not tell you the hit rate on other agencies' layouts or scanned submissions until more PDFs are added.
