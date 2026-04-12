# Architecture

One-page mental model of sales-agent.

## Layers

```
┌────────────────────────────────────────────────────────────┐
│  User invocation (via harness chat)                        │
│  "Run cold-outreach on these URLs …"                       │
└────────────────────────┬───────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│  Skill markdown (skills/*.md)                              │
│  Pure instruction. No code. Skills reference:              │
│   - CLAUDE.md         (message rules)                      │
│   - program.md        (universal constraints)              │
│   - src/config.ts     (which CRM + channels are active)    │
│   - _MCP_MAPPING      (which MCP tools to call)            │
└──────┬─────────────────────────────────────────────────────┘
       │
       ├──▶ invokes CRM MCP via harness (mcp__<crm>__*)
       │    — translates per src/adapters/<crm>.ts _MCP_MAPPING
       │
       ├──▶ invokes Channel MCP via harness (mcp__<channel>__*)
       │    — translates per src/channels/<channel>.ts _MCP_MAPPING
       │
       └──▶ shells out to local CLI for tracker / rate-limiter / scoring / learnings / performance
            — purely local, runs in Node via `npx tsx`

                         ▼
┌────────────────────────────────────────────────────────────┐
│  tracker.db (SQLite, WAL)                                  │
│  - tracker        (1 row per contact, multi-identifier)    │
│  - notes          (sqlite-CRM mode)                        │
│  - tasks          (sqlite-CRM mode)                        │
│  - deals          (sqlite-CRM mode)                        │
│  - rate_state     (per-action counters)                    │
└────────────────────────────────────────────────────────────┘
```

## Data flow (cold-outreach / linkedin example)

1. Skill reads target list from user invocation.
2. For each target:
   a. `tracker.ts find <linkedin_url>` — dedup.
   b. `rate-limiter.ts check linkedin_connect` — capacity.
   c. `mcp__linkedin__get_person_profile` — research.
   d. `scoring.ts score <contact_id> --data ...` — tier.
   e. Draft the 300-char note.
   f. `mcp__linkedin__connect_with_person` — action.
   g. `rate-limiter.ts record linkedin_connect` — counter.
   h. `tracker.ts upsert --json ...` — log.
   i. For external CRM: `mcp__<crm>__*` upsert + note-add.
   j. Sleep 30–120 s.
3. `learnings.ts append heartbeat|observation` — close the run.

## Separation of concerns

| Concern | Where |
|---|---|
| What to say | `skills/*.md` + `CLAUDE.md` + `knowledge/research-config.md` |
| Who to say it to | CRM adapter + tracker + scoring |
| How often (safety) | `src/rate-limiter.ts` |
| Did it work (feedback) | `src/performance.ts` + `inbox-classifier` skill + Section B/C |
| MCP tool invocation | The harness (not our code) |
| Tracker / scoring / learnings | Node CLIs (always local) |

## Why SQLite (even with an external CRM)

- **Activity log stays local and fast.** Every touch, every rate-limit tick,
  every fit/engagement score.
- **Survives CRM migration.** Change `agent.config.json` → `crm` and the
  tracker keeps your history; new rows start tagging with the new `crm_source`.
- **Offline-capable.** Scoring, analytics, learnings all run without network.
- **No CRM pollution.** Agent-internal state (rate counters, skill tags)
  doesn't land in your CRM.

## Why adapters are type contracts, not HTTP clients

sales-agent's adapters (`src/adapters/*.ts`, `src/channels/*.ts`) are
TypeScript interfaces + MCP-tool-argument mappings, NOT runtime HTTP clients.

- Actual MCP invocations happen in your harness at skill execution time.
- Skills read the `_MCP_MAPPING` constants to know exactly which MCP tool to
  call with which arguments.
- The SQLite adapter IS fully runtime — it's the one path where no MCP is involved.

This keeps the Node dependency surface minimal and avoids reimplementing each
CRM's HTTP auth/pagination/rate-limit logic when the harness already handles
that via MCP OAuth.

## Adding a new CRM or channel

See `src/adapters/README.md` and `src/channels/README.md`. The pattern is:
1. Implement the interface.
2. Document the MCP tool mapping as a `_MCP_MAPPING` const.
3. Register in `loadAdapter()` / `loadChannel()`.
4. Add a walkthrough to `docs/crm-adapters.md` / `docs/channels.md`.
5. If the new channel has rate limits, add a key in `src/rate-limiter.ts`.
