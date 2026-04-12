# Migration from `hubspot-email-agent` / `linkedin-sales-agent`

If you were running one of the progenitor agents, import your existing
`tracker.db` into sales-agent's unified schema.

## Why migrate

- Unified schema (UUID contact_id, multi-identifier indexes, per-channel state)
- Channel-aware scoring + reply taxonomy
- Same skill names, broader capabilities
- Multi-CRM support on top of what you had

## What changes

| Progenitor | Schema notes | sales-agent schema |
|---|---|---|
| `hubspot-email-agent` | email PK, 16 columns, `drafted_at`, `reply_classification`, `hubspot_status_after`, `fit_score` | contact_id UUID PK, 22 columns; `email_last_drafted_at`, `reply_channel='email'`, `reply_classification`, `lead_status`, `fit_score` |
| `linkedin-sales-agent` | linkedin_url PK, 22 columns, `connection_sent_at`, `last_message_at`, `reply_*`, `fit_score` | contact_id UUID PK; `linkedin_connection_sent_at`, `linkedin_last_message_at`, `reply_channel='linkedin'` |

## Migration script (reference)

sales-agent v1 doesn't ship an automated migration — the mapping is small
enough that you can do it interactively. Recommended approach:

### Option A — Use `contact-manager` manually

For fewer than ~50 contacts:
1. Open the progenitor's `tracker.db` in a SQLite browser.
2. From sales-agent, run `contact-manager` mode.
3. For each contact: paste an `upsert` command. Takes ~30 seconds per row.

### Option B — Batch SQL import

For more rows, write a one-off script like:

```sql
-- In sqlite3 on ~/sales-agent/tracker.db
ATTACH '/Users/marco/hubspot-email-agent/tracker.db' AS old;

INSERT INTO tracker (
  contact_id, crm_source, email, firstname, lastname, company,
  lead_status, notes_summary,
  email_last_draft_id, email_last_drafted_at,
  reply_channel, reply_received_at, reply_classification, reply_body_snippet,
  fit_score, engagement_score, priority_tier, status
)
SELECT
  -- generate a UUID — SQLite doesn't have one natively; use hex(randomblob(16))
  -- and format as a UUID-ish string. For a quick migration this is fine; sales-agent
  -- re-uses whatever you put here as contact_id.
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
  'hubspot',
  lower(email),
  firstname, lastname, company,
  lead_status, notes_summary,
  draft_id, drafted_at,
  CASE WHEN reply_classification = '' THEN '' ELSE 'email' END,
  reply_received_at, reply_classification, '',
  fit_score, engagement_score, priority_tier, status
FROM old.tracker;

DETACH old;
```

For `linkedin-sales-agent` → sales-agent:

```sql
ATTACH '/Users/marco/linkedin-sales-agent/tracker.db' AS old;

INSERT INTO tracker (
  contact_id, crm_source, linkedin_url, firstname, lastname, company,
  job_title, headline, location,
  linkedin_connection_status, linkedin_connection_note,
  linkedin_connection_sent_at, linkedin_connection_accepted_at,
  linkedin_last_message_at, linkedin_last_message_snippet,
  reply_channel, reply_received_at, reply_classification, reply_body_snippet,
  notes_summary, fit_score, engagement_score, priority_tier, status
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
  'sqlite',
  linkedin_url,
  firstname, lastname, company,
  job_title, headline, location,
  connection_status, connection_note,
  connection_sent_at, connection_accepted_at,
  last_message_at, last_message_snippet,
  CASE WHEN reply_classification = '' THEN '' ELSE 'linkedin' END,
  reply_received_at, reply_classification, reply_body_snippet,
  notes_summary, fit_score, engagement_score, priority_tier, status
FROM old.tracker;

DETACH old;
```

After import, rerun scoring to normalize for the new engagement model:

```bash
npx tsx src/scoring.ts score-tracker
```

## Learnings migration

`knowledge/learnings.md` Section C is human-owned. Open the progenitor's
learnings.md and paste any Section C rules you want to carry forward into
sales-agent's `knowledge/learnings.md` Section C manually. Don't migrate
Section B — start fresh for the unified agent.

## Keep the progenitors as archives

Don't delete `~/hubspot-email-agent/` or `~/linkedin-sales-agent/` right away.
Keep them on disk for a few weeks in case you need to reference historical
drafts or notes that didn't come over in the migration.

When you're comfortable, you can `mv ~/hubspot-email-agent ~/hubspot-email-agent.archive.2026` to declutter without losing the reference.
