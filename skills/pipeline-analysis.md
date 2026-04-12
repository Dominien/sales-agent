# Skill — pipeline-analysis

> **Mode:** one-shot, zoom-out.
> **Output:** `output/analysis/pipeline-<date>.md` + terminal summary.
> **Prerequisite:** `performance-review` run first (so Section C is fresh).

## When to use

Monday morning. Decide the week's focus: what's in pipeline, what's stuck,
which skill to run next.

## Inputs

- `window_days` (default 14) — look-back for "recent activity"

## Steps

1. **Pull tracker rows** (`tracker.ts rows`).
2. **If CRM supports deals** (`hubspot | close | attio | salesforce | sqlite`):
   call `crm.listDeals()` and join on `contact_id` to enrich the view with
   stage + amount + close_date.
3. **Segment:**
   - By `priority_tier`: A / B / C / D / (unscored)
   - By `crm_source`
   - By primary channel (`email` vs `linkedin` — inferred from which timestamp is latest)
   - By `reply_classification`: POSITIVE_* / NEGATIVE_* / NEUTRAL / BOUNCE / SPAM / (none)
   - By deal stage (if deals available)
4. **Compute health flags:**
   - Tier A with POSITIVE_INTENT reply and no outbound in 7 days → `compose-reply` candidate
   - Tier A+B CONNECTED on LinkedIn with no reply >14 days → `follow-up-loop` or `lead-recovery`
   - Deals in stage "Needs Follow-up" / "Stalled" → `lead-recovery`
   - LinkedIn `REQUEST_SENT` > 21 days old → candidate for withdrawal
5. **Data quality:**
   - Rows missing `fit_score` → recommend `prospect-research`
   - Rows where `reply_classification = NEGATIVE_HARD` but `status = sent` recently → flag contradiction
6. **Run `src/performance.ts --window <window_days>`** to surface numeric contrasts.
7. **Write report:**

```markdown
# Pipeline Analysis — <date>

## Totals
...

## By priority_tier
...

## By channel × crm_source
...

## Deals by stage
...

## Health Flags
- <N> tier-A with positive reply, no follow-up
- <M> LinkedIn connections silent > 14 days
- ...

## Recommended next skill
- <Skill name> — <one-line rationale>
```

## End of run

Heartbeat: `pipeline-analysis: <N> rows, <flags> flagged, next = <skill>`.

## Does NOT do

- No outreach.
- Does not promote Section C rules (that's `performance-review`).
- Does not mutate CRM state.
