# Eval report — baseline

Run: 2026-09-09T05:16:15.200Z
ANTHROPIC_API_KEY present: false

> **No baseline pass rate exists for the 30-item real golden set in this run — every item is honestly reported as SKIPPED, not estimated or faked.** This sandbox has no `ANTHROPIC_API_KEY` available (confirmed via a real API call — see the Phase 3 README section). None of the 30 real openers are catchable by a hard trigger on their own (the real transcript has no complaint/payment/human-request phrasing — see evals/README.md for why), so all 30 require a live model call this run can't make. Only the synthetic supplement's hard-trigger items (s01, s02, s03, s06) get graded here, since those bypass the model entirely by design. Re-run with a real key to get the actual baseline.

## Summary — 30-item real golden set

Graded: 0/30 · Skipped (no API key): 30/30
Pass rate: N/A (nothing graded this run)

| ID | Category | Status | Answered | Tools called | Tool ✓ | Escalated (src) | Escalate ✓ | Hallucination | Pass |
|---|---|---|---|---|---|---|---|---|---|
| g01 | helper_background | SKIPPED | — | — | — | — | — | — | — |
| g02 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g03 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g04 | scheduling_status | SKIPPED | — | — | — | — | — | — | — |
| g05 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g06 | scheduling_and_candidates | SKIPPED | — | — | — | — | — | — | — |
| g07 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g08 | cost | SKIPPED | — | — | — | — | — | — | — |
| g09 | candidate_request | SKIPPED | — | — | — | — | — | — | — |
| g10 | candidate_preference | SKIPPED | — | — | — | — | — | — | — |
| g11 | helper_background | SKIPPED | — | — | — | — | — | — | — |
| g12 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g13 | candidate_feedback | SKIPPED | — | — | — | — | — | — | — |
| g14 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g15 | scheduling_status | SKIPPED | — | — | — | — | — | — | — |
| g16 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g17 | scheduling | SKIPPED | — | — | — | — | — | — | — |
| g18 | cost_and_scheduling | SKIPPED | — | — | — | — | — | — | — |
| g19 | candidate_scheduling | SKIPPED | — | — | — | — | — | — | — |
| g20 | cost | SKIPPED | — | — | — | — | — | — | — |
| g21 | guarantee | SKIPPED | — | — | — | — | — | — | — |
| g22 | fee_breakdown | SKIPPED | — | — | — | — | — | — | — |
| g23 | mom_process | SKIPPED | — | — | — | — | — | — | — |
| g24 | mom_process | SKIPPED | — | — | — | — | — | — | — |
| g25 | timeline | SKIPPED | — | — | — | — | — | — | — |
| g26 | timeline | SKIPPED | — | — | — | — | — | — | — |
| g27 | mom_process | SKIPPED | — | — | — | — | — | — | — |
| g28 | post_placement_logistics | SKIPPED | — | — | — | — | — | — | — |
| g29 | immigration_advice | SKIPPED | — | — | — | — | — | — | — |
| g30 | candidate_status | SKIPPED | — | — | — | — | — | — | — |

## Summary — synthetic escalation-coverage supplement (NOT part of the 30-item baseline)

Graded: 3/6 · Skipped: 3/6
Pass rate among graded items: 3/3

| ID | Category | Status | Answered | Tools called | Tool ✓ | Escalated (src) | Escalate ✓ | Hallucination | Pass |
|---|---|---|---|---|---|---|---|---|---|
| s01 | human_request | graded | yes | (none) | n/a | true (hard_trigger) | yes | no | ✓ |
| s02 | complaint | graded | yes | (none) | n/a | true (hard_trigger) | yes | no | ✓ |
| s03 | payment | graded | yes | (none) | n/a | true (hard_trigger) | yes | no | ✓ |
| s04 | eligibility | SKIPPED | — | — | — | — | — | — | — |
| s05 | cost_gap | SKIPPED | — | — | — | — | — | — | — |
| s06 | complaint | SKIPPED | — | — | — | — | — | — | — |

## Per-item detail — real golden set

### g01 — helper_background

**Opener:**
```
the helpers: they normally don't work longer than three years? What's Lestari's reason for not continuing her current batam job?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g02 — scheduling

**Opener:**
```
Jassey is Lestari available to be interviewed tomorrow?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g03 — scheduling

**Opener:**
```
cannot
old helper still at home
tmr morning better
10am OK ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g04 — scheduling_status

**Opener:**
```
Jassey, are we interviewing Lestari？
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g05 — scheduling

**Opener:**
```
im sorry now's not a good time
345pm tmr OK ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g06 — scheduling_and_candidates

**Opener:**
```
night time cannot because current helper still around
office hours we're in office then more convenient
meanwhile if u have more profiles, can send over, so we can slot in those interviews also?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g07 — scheduling

**Opener:**
```
i'm trying to slot in more interviews from another agency
could we start interviewing Lestari at 330pm?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g08 — cost

**Opener:**
```
@Jassey Khoo - how much is Lestari's salary?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g09 — candidate_request

**Opener:**
```
Jassey, thanks a lot for Lestari — you got one more for comparison?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g10 — candidate_preference

**Opener:**
```
prefer to not interview for now
the others prefer don't want to take care 18 months baby?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g11 — helper_background

**Opener:**
```
u think possible for us to find out what Lestari's previous employer would say about her? Did she have a reference letter ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g12 — scheduling

**Opener:**
```
could we arrange 10am Juliana 1030am Nurfitriana?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g13 — candidate_feedback

**Opener:**
```
will pass on this one
children too young and serang to jkt is very diff from sg to serang
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g14 — scheduling

**Opener:**
```
Jassey, I'm sorry we need to reschedule to afternoon
Could I get back to you on the timing later this morning ?
how about 1-2pm?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g15 — scheduling_status

**Opener:**
```
we speak to Juliana now, correct?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g16 — scheduling

**Opener:**
```
@Jassey Khoo sorry - i ran out of time le
can we continue with Fitriana sometime on Sat?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g17 — scheduling

**Opener:**
```
Jassey, let us know if OK to start now - we need to leave home 1030am as baby see doctor today
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g18 — cost_and_scheduling

**Opener:**
```
@Jassey Khoo we've decided to compare sulastri, lestari and fitriani
how much is their monthly expected salary, and is it possible for us to chat with Lestari and Sulastri one last time this afternoon?
then we can give u an answer by today
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g19 — candidate_scheduling

**Opener:**
```
just now you say Lestari more mature right ?
can arrange for one final call now with her ?
then we decide lu
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g20 — cost

**Opener:**
```
@Jassey Khoo we will go with Lestari
what's the paperwork we need to do and how much is your agency fees ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g21 — guarantee

**Opener:**
```
this one got guarantee period, and if yes for how long ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g22 — fee_breakdown

**Opener:**
```
in-transit transport is cover lestari from where to where?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g23 — mom_process

**Opener:**
```
what shd i do?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g24 — mom_process

**Opener:**
```
@Jassey Khoo - do u need em to do anything on this website ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g25 — timeline

**Opener:**
```
i'm trying to coordinate when to send my current helper back to indo
tentatively I'm thinking end-August. u think enough time ?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g26 — timeline

**Opener:**
```
Jassey, just checking whether 29 August is OK?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g27 — mom_process

**Opener:**
```
can i inform my existing agent to release work permit now?
or better wait till ticket booked first?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g28 — post_placement_logistics

**Opener:**
```
hello Jassie, can we ask when Lestari will receive her Work Permit? 

She also mentioned she doesn't have a bank acc, shd we help her open? 

Her sim card - that's prepaid and she needs to reload every month isit?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g29 — immigration_advice

**Opener:**
```
before that, we can't go back to malaysia with her right? hahaha
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### g30 — candidate_status

**Opener:**
```
Sulastri just got released by another employer
Fitriana yes let's continue
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

## Per-item detail — synthetic supplement

### s01 — human_request

**Opener:**
```
can I just speak to a real person about this
```

**Reply:**
```
(hard-trigger ack — not a model reply)
```
**Tools called:** (none)
**Escalated:** true (source: hard_trigger, expected: matches=true)
**Overall:** PASS

---

### s02 — complaint

**Opener:**
```
this is really not acceptable, I've been waiting for days and no one is helping me
```

**Reply:**
```
(hard-trigger ack — not a model reply)
```
**Tools called:** (none)
**Escalated:** true (source: hard_trigger, expected: matches=true)
**Overall:** PASS

---

### s03 — payment

**Opener:**
```
ok can I PayNow you the deposit now to lock it in?
```

**Reply:**
```
(hard-trigger ack — not a model reply)
```
**Tools called:** (none)
**Escalated:** true (source: hard_trigger, expected: matches=true)
**Overall:** PASS

---

### s04 — eligibility

**Opener:**
```
we're a couple with a newborn and my elderly mother lives with us too — do we qualify for a second helper?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### s05 — cost_gap

**Opener:**
```
how much would a Filipino helper cost, similar setup to what you quoted before?
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

---

### s06 — complaint

**Opener:**
```
actually forget it, this whole process is a joke, waste of my time
```

_Skipped — no ANTHROPIC_API_KEY available, model was never called for this item._

