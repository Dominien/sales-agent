# Skill — follow-up-loop

> **Mode:** loop (autonomous for LinkedIn, draft-for-review for email)
> **Works with any CRM + any channel.** Handles contacts with only email, only LinkedIn, or both.

## When to use

Re-touch contacts who've gone silent. Queue:
- **Email:** rows where `email_last_drafted_at` is older than N days AND no reply
- **LinkedIn (1st-degree only):** rows where `linkedin_connection_status = CONNECTED` AND (`linkedin_last_message_at` empty OR older than N days) AND no reply

## Inputs

- `stale_days` (default 7)
- `max_per_run` (default = rate-limiter daily cap)
- `tier_filter` (default from `config.defaults.tier_filter_default`, usually `A,B`)
- `channel` — `auto` (default), `email`, `linkedin`, `both`

## Channel routing (auto mode)

For each contact:
1. Is there an open thread in either channel? → reuse that channel.
2. Is only one identifier known (email OR linkedin_url)? → use that.
3. Both known, no open thread? → use the first channel in `config.defaults.channel_priority`.
4. `both` mode: send on each channel with DIFFERENT message bodies 24+ hours apart.

## Loop

1. Pull queue from tracker, filter by tier, sort (A → B → C, then oldest-first).
2. For each contact:
   a. Pick channel (rules above).
   b. Read context:
      - Email: `mcp__gmail__gmail_list_drafts` + last thread via `gmail_read_thread` if recoverable.
      - LinkedIn: `npx tsx src/linkedin/cli.ts get-conversation --linkedin-username <user>` (or `--thread-id <id>`).
   c. Compose follow-up per `CLAUDE.md` → Message Rules.
   d. `rate-limiter.ts check <action>`. Exit on fail.
   e. Send:
      - Email: `mcp__gmail__gmail_create_draft` (DRAFT — user reviews and sends).
      - LinkedIn: `npx tsx src/linkedin/cli.ts send-message --linkedin-username <user> --message "<text>" --confirm-send true` (autonomous).
   f. Record rate-limit counter + update tracker (`last_message_at`, `notes_summary=FU: ...`, `status=sent`).
   g. Sleep 30–120 s.
3. Continue until exhausted or stop condition.

## End of run

Heartbeat: `follow-up-loop: <channel(s)>, <N> sent, <M> drafted, <S> skipped`.

## Stop conditions

- Rate-limit check fails
- Max-per-run reached
- Queue empty
- User interrupt

## Does NOT do

- Does not send first touches (`cold-outreach`).
- Does not classify replies (`inbox-classifier`).
- Does not target non-1st-degree LinkedIn contacts.
