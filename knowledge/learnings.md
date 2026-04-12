# Learnings — sales-agent

Three sections:

- **A — Cheat Sheets** (static): fast reference during a skill run.
- **B — Running Log** (append-only, newest first): every skill run writes one
  entry via `src/learnings.ts append`. Heartbeat or observation.
- **C — Distilled Rules** (human-promoted from B): `performance-review` proposes
  candidate blocks; user pastes here by hand after review.

---

## Section A — Cheat Sheets

### A.1 — 8-way reply classification (cross-channel)

| Code | Signal | Action (email) | Action (linkedin) |
|---|---|---|---|
| `POSITIVE_INTENT` | "Tell me more", general curiosity | draft reply + calendar link (user sends) | auto-send reply + calendar link |
| `POSITIVE_MEETING` | Meeting ask, time proposed | draft confirming reply | auto-send confirming reply |
| `POSITIVE_QUESTION` | Detail question | draft answer + next step | auto-send answer |
| `NEUTRAL` | Acknowledgment | draft polite holder (user sends) | draft only; user reviews |
| `NEGATIVE_SOFT` | "Not right now" | draft polite close (user sends) | draft only |
| `NEGATIVE_HARD` | Hard no / unsubscribe | no draft; skip forever | no draft; skip forever |
| `BOUNCE` | Out of office / left company / undeliverable | no draft; skip forever | n/a |
| `SPAM_FLAG` | Looks like spam | skip | skip |

### A.2 — Tone defaults

| Profile / context | Greeting | Register |
|---|---|---|
| Founder / creator / agency / startup | First name | Casual-professional |
| C-suite at corporate / law / bank | Last name / title | Formal |
| German profile, no casual signals | Herr / Frau + surname | Formal, "Sie" |
| Non-native English, mixed signals | First name | Semi-formal, short |
| Doubt | First name | Semi-formal (safest) |

### A.3 — Connection note structure (LinkedIn, ≤ 300 chars)

```
[Greeting] — [one specific hook from their profile / recent post].
[1 sentence: why you're reaching out; signal *their* value].
[1 question OR 1 soft CTA].
```

### A.4 — Rate-limit guardrails (defaults — override in `agent.config.json`)

| Action | Daily | Weekly | Why |
|---|---|---|---|
| `email_draft` | 200 | — | Sanity cap; drafts still need human review |
| `linkedin_connect` | 20 | 80 | LinkedIn flags at ~100/week |
| `linkedin_message` | 40 | — | Account-level suspicion threshold |

Hard-stop rule: 3 consecutive errors on `connect_with_person` → skill exits and appends an observation.

### A.5 — CRM mapping quick reference

The canonical sales-agent `Contact` maps to:
- **HubSpot:** `Contact` object (email as primary identifier)
- **Close:** `Lead` + primary `Contact` (company-first model)
- **Attio:** `People` record
- **Salesforce:** `Contact` (post-qualified) or `Lead` (pre-qualified) — adapter treats uniformly
- **SQLite:** tracker row

See `knowledge/crm-field-mapping.md` for field-level details.

---

## Section B — Running Log

> Entries appended via `npx tsx src/learnings.ts append`. Newest first, unbounded.
> Trim manually in the editor if it gets too long.

<!-- LEARNINGS_LOG_START -->

<!-- LEARNINGS_LOG_END -->

---

## Section C — Distilled Rules

> User-promoted from Section B. Each rule cites its evidence.
> `performance-review` proposes candidate blocks; user pastes them here by hand.

<!-- Example template — delete once your own rules land:

### C.1 — Rule name

- **Evidence:** 2026-04 week 15, LinkedIn cold-outreach, 23 invites, 48% accept rate vs 19% baseline.
- **Rule:** When targeting B2B SaaS Heads-of-Growth at 10–50-person companies, lead the invite note with a reference to their most recent LinkedIn post (within last 14 days).
- **Why:** People who post recently are signaling they want conversations about what they posted.
-->

## Appendix

- Section A: static, hand-edit only.
- Section B: machine-appended via `src/learnings.ts`.
- Section C: human-edited only, after weekly review.
