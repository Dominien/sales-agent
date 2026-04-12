# Program — Universal Skill Constraints

> Defines constraints every skill in `skills/` must respect. Skills extend,
> but never weaken, these rules.

## Mission

Help the user run personalized outreach across their chosen CRM and channels
at scale, learning from what works. Every action is logged to `tracker.db`
and (for external CRMs) mirrored into the CRM. Every run appends one entry
to `knowledge/learnings.md` Section B.

## Skills (10)

| Skill | Purpose |
|---|---|
| `cold-outreach` | First-touch via email or LinkedIn invite |
| `follow-up-loop` | Channel-aware re-touch loop |
| `inbox-classifier` | Cross-channel reply classification + auto-handling |
| `prospect-research` | Dossiers; fit-score updates |
| `research-outreach` | Evidence-backed warm touch |
| `lead-recovery` | Stale-lead decision framework |
| `compose-reply` | Single high-value reply with full context |
| `pipeline-analysis` | Weekly zoom-out; recommends next skill |
| `performance-review` | Weekly math; proposes Section C rules |
| `contact-manager` | CRM CRUD from the terminal |

## Universal rules

1. **Tracker is the source of truth for activity.** Always query it first.
   External CRM is the source of truth for the CANONICAL contact record.
2. **Rate-limiter check before every send.** See `CLAUDE.md` for the contract.
3. **Dedup on identifiers.** All identifiers are normalized: email → lowercase;
   LinkedIn URL → `https://www.linkedin.com/in/<slug>` lowercase; UUID stays as-is.
4. **One language per message.** Match the profile / thread language.
5. **Never invent personalization.** If no hook → skip.
6. **Append to learnings at end of every run.**
7. **Changes in approach get an observation.** If you consciously tried a new
   hook / tone / cadence, record it so `performance-review` can weigh it.

## Scoring utility

`src/scoring.ts` writes three columns per contact:
- `fit_score` (0–100) — from profile/CRM data (industry, title, company size, location)
- `engagement_score` (0–100) — from tracker data (connection status, replies, recency)
- `priority_tier` — A/B/C/D from the fit × engagement matrix in `knowledge/scoring-config.md`

Skills consume `priority_tier` for queue ordering.

## CRM + Channel separation

- A **CRM** owns the canonical contact record (plus optionally deals, notes,
  tasks). Skills call `crm.*` methods; the adapter maps to MCP / HTTP / SQLite.
- A **Channel** sends messages and reads inboxes. Skills call `channel.*`
  methods or invoke MCP tools directly per the `_MCP_MAPPING` constants.
- The tracker joins them — per-contact rows with both `crm_source + crm_id`
  AND per-channel state columns.

## No-CRM mode (`crm = sqlite`)

SQLite adapter implements the full `CRMAdapter` interface locally:
- contacts → `tracker` table
- notes → `notes` table
- tasks → `tasks` table
- deals → `deals` table

All skills work identically in this mode. When the user graduates to an
external CRM, existing SQLite data stays — just change `agent.config.json`
and migrate identifiers via `contact-manager`.

## Two-path tool architecture

- **Path A (MCP):** `mcp__<provider>__*` tools. Primary path for external CRMs
  and channels. Runs in your harness.
- **Path B (CLI):** `npx tsx src/*.ts`. Always-local tracker, rate-limiter,
  scoring, performance, learnings. For `crm=sqlite`, also contacts / notes /
  tasks / deals.
