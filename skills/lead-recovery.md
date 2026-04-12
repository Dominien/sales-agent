# Skill — lead-recovery

> **Mode:** analysis only. NO sends.
> **Output:** `output/analysis/recovery-<date>.md` + terminal summary.

## When to use

Weekly / biweekly. Decide what to do with stale or stalled leads. Feeds
`research-outreach` and `compose-reply`.

## Inputs

- `stale_days` (default 21): no reply AND last touch older than this
- `tier_filter` (default `A,B`)

## Loop

1. Pull candidates from tracker where:
   - `reply_classification` is empty OR `NEUTRAL` or `NEGATIVE_SOFT` (not hard nos)
   - last touch older than `stale_days`
   - tier ∈ filter
2. For each deal (if CRM supports `listDeals`): join on `contact_id` and include deal stage in the row.
3. Decide lever for each candidate:
   - **Fresh-face** — different sender (you bring in a teammate)
   - **Value-first** — run `prospect-research` + `research-outreach` with a brand-new hook
   - **Trigger-based** — wait for a signal; flag profile / company in a watch list
   - **Close** — flag as NEGATIVE_SOFT manually, stop spending cycles
4. Assign confidence (High/Med/Low) based on tier, touch count, prior signals.
5. Write report to `output/analysis/recovery-<YYYY-MM-DD>.md`:

```markdown
# Recovery Analysis — <date>

## Summary
- <N> stale leads reviewed
- <A> fresh-face, <B> value-first, <C> trigger-based, <D> close

## Recommendations
| contact_id | Name | Tier | Channel(s) | Days stale | Lever | Next step | Confidence |
|---|---|---|---|---|---|---|---|
...
```

6. Print the summary block to terminal.

## End of run

Heartbeat: `recovery: <N> reviewed, <A>/<B>/<C>/<D> levers assigned`.

## Does NOT do

- No sends, no drafts.
- Does not update tracker fields — that's a manual tracker.ts reply for `close` leads.
