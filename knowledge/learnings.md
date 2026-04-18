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
| `NEGATIVE_HARD` | Hard no / unsubscribe | no draft; `tracker.ts skip <id> negative_hard` | no draft; `tracker.ts skip <id> negative_hard` |
| `BOUNCE` | Out of office / left company / undeliverable | no draft; `tracker.ts skip <id> bounce` | n/a |
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

### A.4b — `do_not_contact` semantics

The tracker column `do_not_contact` (free-text reason) is the single gate that
`cold-outreach` and `follow-up-loop` honor before sending. Any non-empty value
means "never contact this person again on any channel".

| Reason | Set by | When |
|---|---|---|
| `bounce` | `inbox-classifier` | Gmail returns an undeliverable / "no such user" reply |
| `unsubscribe` | user (manual) | Contact asked to be removed by any channel |
| `negative_hard` | `inbox-classifier` | Reply classified as hard-no |
| `manual` | user | Deliberate exclusion (wrong person, legal, ethical) |
| `""` (empty) | — | Contactable |

### A.4c — Skip-flag tiers (derived from notes_summary + lead_status)

Beyond the canonical `do_not_contact` column, `src/skip-flags.ts` categorizes
free-text notes into three tiers. `cohort-builder.ts` uses these by default.

| Tier | Meaning | Examples |
|---|---|---|
| `hard` | Never contact | unsubscribe, bounce, left company, not interested |
| `warm` | Not now — someone else owns it or timing is wrong | owned_by_other_rep, lost_to_competitor, closed_lost, parked, bad_timing |
| `personal` | Life event — give space | parental_leave, health, bereavement, sabbatical |

Skills default to excluding all three. Pass `--allow-skip personal` when
running a deliberate life-event re-engage campaign; `--allow-skip warm` for
owner-change or post-competitor-churn sweeps.

### A.4d — LinkedIn connect status taxonomy (read carefully)

`npx tsx src/linkedin/cli.ts connect` returns one of the following `status`
values. Skills **must** route on these distinctions — they determine whether
rate-limiter counters advance and whether the contact counts toward the
3-consecutive-error hard-stop.

| Status | Rate budget | Counts as error | Action |
|---|---|---|---|
| `connected` | Yes — record `linkedin_connect` | No | Tracker: `linkedin_connection_status=REQUEST_SENT` |
| `accepted` | Yes | No | Tracker: `linkedin_connection_status=CONNECTED` |
| `already_connected` | No | No | Tracker: ensure `CONNECTED` |
| `pending` | No | No | Skip this contact; already queued |
| `follow_only` / `connect_unavailable` | No | No | Skip; note in tracker |
| `silent_reject` | **No** | **No** | LinkedIn closed dialog without Pending (upsell/throttle). Skip this contact and **continue the batch**. |
| `send_failed` | No | **Yes** | Real error — advance consecutive-error counter |

The validator auto-retries transient `send_failed` once with a 3s pause
(`retry_attempts=2` in the result); treat the retried result as authoritative.

### A.4e — Note-quota auto-fallback

Free-tier LinkedIn caps personalized invite notes at ~5/month. When the
scraper detects that a note was requested but the textarea was unavailable,
the skill pipeline:

1. Saturates the `linkedin_connect_note` monthly counter
   (`npx tsx src/rate-limiter.ts saturate linkedin_connect_note`).
2. Continues the batch with bare invites for the remainder of the month.
3. Stores the drafted note in `tracker.linkedin_connection_note` and delivers
   it as the FIRST `send-message` after acceptance.

There is no mid-batch user prompt. The fallback is silent on purpose.

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

### C.1 — Bridge re-engagement: prefer commercial hooks over aesthetic ones

- **Evidence:** LinkedIn Bridge Wave 1 retrospective, April 2026. One invite
  referencing an aesthetic / implementation detail from prior-conversation
  notes was trimmed by the user before send — felt presumptuous for a
  re-opener after silence. Commercial state (budget bracket, timeline,
  project type, last-proposed scope) was accepted without edits.
- **Rule:** When composing bridge-style outreach (contact went silent after
  a prior commercial conversation), anchor the hook on *commercial Verbleib*
  — last quoted scope, last-discussed timeline, the specific deal stage at
  which silence fell. Do NOT reference aesthetic, stylistic, or
  implementation-detail fragments unless the contact themselves raised it
  in the most recent thread.
- **Why:** Referencing aesthetic details after a silence gap reads as
  "I've been watching too closely." Commercial references read as "here's
  where we left off" — functional and respectful of the pause.

<!-- Example template for future rules:

### C.N — Rule name

- **Evidence:** 2026-04 week 15, LinkedIn cold-outreach, 23 invites, 48% accept rate vs 19% baseline.
- **Rule:** When targeting B2B SaaS Heads-of-Growth at 10–50-person companies, lead the invite note with a reference to their most recent LinkedIn post (within last 14 days).
- **Why:** People who post recently are signaling they want conversations about what they posted.
-->

## Appendix

- Section A: static, hand-edit only.
- Section B: machine-appended via `src/learnings.ts`.
- Section C: human-edited only, after weekly review.
