# Skill — inbox-classifier

> **Mode:** one-shot (reactive). Recommend 1–2× daily.
> **Reads ALL enabled channels' inboxes.**

## When to use

After any batch of outreach. Polls every enabled channel, classifies new replies
into 8 categories, auto-handles positives, and updates the tracker + CRM.

## Inputs

- `since` (default: 48 h ago — or last run)
- `auto_reply` (default `true` for LinkedIn `POSITIVE_*`; email always draft-only)
- `channels` (default: all from config)

## 8-way classification taxonomy

Identical to both progenitor agents:
`POSITIVE_INTENT | POSITIVE_MEETING | POSITIVE_QUESTION | NEUTRAL | NEGATIVE_SOFT | NEGATIVE_HARD | BOUNCE | SPAM_FLAG`

## Loop

For each enabled channel:

### Email
1. `mcp__gmail__gmail_search_messages({query: "newer_than:<N>d in:inbox"})`
2. For each new message (not already classified in tracker for this contact since `since`):
   a. `gmail_read_thread({id: threadId})` for full context.
   b. Classify the latest inbound into one of 8 codes.
   c. Identify sender via `From:` header → resolve to `tracker.contact_id` (create if new).
   d. For `POSITIVE_*`: compose reply per `CLAUDE.md`, `gmail_create_draft` (DRAFT only — email never auto-sends).
   e. For `NEGATIVE_SOFT` / `NEUTRAL`: optionally draft a polite reply text into `notes_summary` with prefix `INBOX-DRAFT:`.
   f. For `NEGATIVE_HARD` / `BOUNCE`: no draft.
   g. `tracker.ts reply <contact_id> email <classification> <snippet>`
   h. For `NEGATIVE_HARD`: also `tracker.ts skip <contact_id> negative_hard`. For `BOUNCE`: `tracker.ts skip <contact_id> bounce`. Both flag the contact as `do_not_contact` so `cold-outreach` and `follow-up-loop` skip them forever.
   i. If CRM is external and `POSITIVE_*`: update CRM lead status via `crm.setLeadStatus`.

### LinkedIn
1. `npx tsx src/linkedin/cli.ts get-inbox --limit 20`. Use the `references` map to harvest `threadId` values.
2. For each new conversation (same de-dup logic):
   a. `npx tsx src/linkedin/cli.ts get-conversation --thread-id <threadId>`.
   b. Classify.
   c. Identify sender → resolve or create tracker row.
   d. For `POSITIVE_*` and `auto_reply=true`:
      - `rate-limiter.ts check linkedin_message`. On fail: skip auto-reply (still classify + log).
      - Compose reply per `CLAUDE.md`. For `POSITIVE_MEETING`, inject `<sender.timezone>` from config when proposing slots; use the link-only fallback when `sender.timezone` is empty.
      - `npx tsx src/linkedin/cli.ts send-message --linkedin-username <user> --message "<text>" --confirm-send true`.
      - `rate-limiter.ts record linkedin_message`.
   e. `tracker.ts reply <contact_id> linkedin <classification> <snippet>`.
   f. For `NEGATIVE_HARD`: also `tracker.ts skip <contact_id> negative_hard`. (LinkedIn has no BOUNCE equivalent.)

## End of run

Heartbeat: `inbox: <N> classified across <C> channels (<P> POSITIVE, <N> NEGATIVE, <U> NEUTRAL), <R> auto-replied, <D> drafted`.

Observation: if a consistent pattern across POSITIVE_* replies points to a
shared hook or subject line, record it for `performance-review`.

## Does NOT do

- Does not auto-send email replies — drafts only.
- Does not delete/archive inbox messages.
- Does not scrape deeper than `since`.
