# Skill — cold-outreach

> **Mode:** one-shot per target list (autonomous, rate-limited)
> **Works with any CRM (`sqlite | hubspot | close | attio | salesforce`) and any channel (`email | linkedin`)**
> **Contract:** `CLAUDE.md` (message rules), `program.md` (dedup, rate limits)

## When to use

First-touch outreach to people NOT yet in your sphere. Input: a seed list of
identifiers (email, LinkedIn URL, or mixed) OR a search spec. Output: N tracker
rows marked `status=sent` + the drafts (email) or sent messages (LinkedIn).

## Required config

`agent.config.json` must have `crm`, at least one `channels`, and `sender`.
The skill reads them via `src/config.ts`.

## Inputs (from user invocation)

- **Targets** — either:
  - A list of identifiers (emails, LinkedIn URLs), OR
  - A `search` spec (LinkedIn: `query` + `location` + `industry`; email campaigns: a CSV of addresses)
- **Channel** — one of `email`, `linkedin`. If a target has only one identifier, that determines the channel.
- **Campaign tag** — free-text, prefixed with `COLD:` in `notes_summary` (e.g. `COLD: B2B SaaS HoG Berlin`).
- **Max sends this run** — capped at the rate-limiter ceiling for the chosen channel.
- **Mode** — `live` (default) | `preview` (write drafts to `output/drafts/` but do not send).

## Loop

### 0. Build the cohort once (pre-flight)

If the caller passed a `search` spec, resolve it first (see step 2 below).
Otherwise, pull the target queue from the tracker in one deterministic call:

```
npx tsx src/cohort-builder.ts build --tier A,B --channel <linkedin|email> --format summary
```

The builder internally applies `src/skip-flags.ts` (hard / warm / personal
tiers) and the `do_not_contact` column. Log the exclusion-by-reason summary
to the heartbeat so later audits can see *why* rows were dropped.

Pass `--allow-skip warm` or `--allow-skip personal` only when the user
explicitly asked to re-engage those tiers. Default behavior: exclude all.

For each target in the returned `included` list (already priority-sorted):

### 1. Dedup (per-row safety check)
```
tracker.ts find <identifier>
```
The cohort builder already excluded hard/warm/personal skips; this step just
guards against races where a reply landed between cohort-build and send.
Skip if any of:
- `do_not_contact != ''`
- `status in {sent, skipped}` AND no NEGATIVE_HARD
- `reply_classification = NEGATIVE_HARD` or `BOUNCE`

### 2. Research + match validation
- **LinkedIn channel, search spec:**
  1. `npx tsx src/linkedin/cli.ts search-people --keywords "<query>" --location "<loc>"`.
  2. Import `{ validate } from 'src/linkedin/match-validator.ts'`. Score the top-N candidates against the tracker's expected `{firstname, lastname, company, location}`. Route on the verdict:
     - `confident` → proceed.
     - `ambiguous` → write the top-2 to `output/research/ambiguous/<slug>.json`, skip this target, continue the loop (NO prompt, NO send).
     - `no_match` → skip, note in tracker.
- **LinkedIn channel, known username:** `npx tsx src/linkedin/cli.ts get-person-profile --linkedin-username <user> --sections experience,posts,honors,certifications`.
- **Email channel:** if the contact is in the CRM, call `crm.getContact(id)`. Optionally `WebFetch` on their company domain for context.

Extract exactly ONE personalization hook per `knowledge/research-config.md`
priority order. For **bridge** re-engagement (contact went silent after prior
commercial conversation), prefer commercial *Verbleib* fragments over
aesthetic / implementation details — see learnings.md §C.1.

If no hook exists → skip (log why in `notes_summary`, mark `status=skipped`).

### 3. Upsert CRM + tracker
- Create the contact in the configured CRM (skip for `sqlite`).
- Upsert the tracker row: `db.upsertContact({crm_source, crm_id, ...})`.

### 4. Score
```
scoring.ts score <contact_id> --data '<json from profile>'
```
Skip if tier = D AND the campaign isn't explicitly targeting D.

### 5. Draft message
Per `CLAUDE.md` → Message Rules. 300-char limit for LinkedIn invite notes.
Language matches profile. No selling in first touch.

**For formal German greetings**, use `src/honorifics.ts` to split any
titles (`Dr.`, `Prof. Dr.`, `Dipl.-Ing.`) out of the `firstname` field
before composing. The helper `formalGreeting({...}, 'de')` renders the
correct `Sehr geehrter Herr Dr. <lastname>` form. Do NOT concatenate raw
`firstname` into a "Herr"-prefixed salutation — that double-renders
honorifics.

### 6. Rate-limit check
```
rate-limiter.ts check <email_draft | linkedin_connect>
```
Exit ≠ 0 → stop the whole loop, heartbeat, exit.

**For LinkedIn invites with a note**, also pre-check the monthly note quota:
```
rate-limiter.ts check linkedin_connect_note
```
If that check blocks, send a **bare** invite (no `--note`) and keep the
drafted note in `tracker.linkedin_connection_note` for post-accept DM
delivery. This is the "no weird brakes" fallback — do NOT prompt the user,
do NOT abort the batch.

### 7. Send (or preview)
- **Preview mode:** write draft text to `output/drafts/cold-<date>-<slug>.md`, continue.
- **Live — email:** `mcp__gmail__gmail_create_draft(...)` → record `email_last_draft_id`.
- **Live — linkedin:** `npx tsx src/linkedin/cli.ts connect --linkedin-username <user> [--note "<≤300 chars>"]`. Exit 2 → stop loop, surface auth error.

Route on the returned `status` (see learnings.md §A.4d):
- `connected` / `accepted` / `already_connected` / `pending` → proceed to step 8.
- `silent_reject` → **skip this contact only**. Do NOT record any rate-limit counter. Do NOT increment the consecutive-error counter. Update tracker with `linkedin_connection_status=silent_reject`. Continue the batch.
- `follow_only` / `connect_unavailable` → skip; note in tracker; no error cost.
- `send_failed` → count as error. The CLI already auto-retried once (`retry_attempts=2`); this is the final verdict. After 3 consecutive `send_failed` → hard-stop, observation, exit.

If the result has `note_sent: false` when a note was provided, saturate the
monthly note budget so the remaining batch auto-falls-back to bare invites:
```
npx tsx src/rate-limiter.ts saturate linkedin_connect_note
```
No prompt, no abort — the drafted note stays in
`tracker.linkedin_connection_note` for post-accept delivery.

### 8. Record
```
rate-limiter.ts record <action>                          # linkedin_connect or email_draft
rate-limiter.ts record linkedin_connect_note             # only if status=connected AND note_sent=true
tracker.ts upsert --json '{"contact_id":"...","status":"sent","notes_summary":"COLD: ...","email_last_draft_id":"..."}'
```

### 9. Errors
Track consecutive **errors** per channel. Only `send_failed` counts — never
`silent_reject`, `follow_only`, `connect_unavailable`, or `ambiguous`
match-validator verdicts. 3 real errors in a row → hard-stop, append
observation, exit.

### 10. Sleep
Jittered 30–120 s before next target.

## End of run

Append ONE learnings entry:
- **Heartbeat** (uneventful): `cold-outreach: <channel>, <N> sent, <M> skipped, <E> errors`
- **Observation** (pattern noticed): record evidence so `performance-review` can weigh it later.

## Stop conditions

- Rate-limit check fails
- 3 consecutive send errors
- Targets exhausted
- `max-sends` reached
- User interrupt

## Does NOT do

- Does not send follow-ups (`follow-up-loop`).
- Does not auto-classify replies (`inbox-classifier`).
- Does not write Section C rules (user-only).
