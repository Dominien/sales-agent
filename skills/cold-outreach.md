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

For each target (in fit-ranked order):

### 1. Dedup
```
tracker.ts find <identifier>
```
If exists AND `status in {sent, skipped}` AND no NEGATIVE_HARD → skip.

### 2. Research
- **LinkedIn channel:** `npx tsx src/linkedin/cli.ts get-person-profile --linkedin-username <user> --sections experience,posts,honors,certifications`.
- **Email channel:** if the contact is in the CRM, call `crm.getContact(id)`. Optionally `WebFetch` on their company domain for context.

Extract exactly ONE personalization hook per `knowledge/research-config.md`
priority order. If no hook exists → skip (log why in `notes_summary`, mark `status=skipped`).

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

### 6. Rate-limit check
```
rate-limiter.ts check <email_draft | linkedin_connect>
```
Exit ≠ 0 → stop the whole loop, heartbeat, exit.

### 7. Send (or preview)
- **Preview mode:** write draft text to `output/drafts/cold-<date>-<slug>.md`, continue.
- **Live — email:** `mcp__gmail__gmail_create_draft(...)` → record `email_last_draft_id`.
- **Live — linkedin:** `npx tsx src/linkedin/cli.ts connect --linkedin-username <user> --note "<≤300 chars>"` (uses `linkedin_connect` rate key). Exit 2 → stop loop, surface auth error.

### 8. Record
```
rate-limiter.ts record <action>
tracker.ts upsert --json '{"contact_id":"...","status":"sent","notes_summary":"COLD: ...","email_last_draft_id":"..."}'
```

### 9. Errors
Track consecutive errors per channel. 3 in a row → hard-stop, append observation, exit.

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
