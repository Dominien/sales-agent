# Skill — performance-review

> **Mode:** one-shot. Closes the feedback loop.
> **Output:** `output/performance/<date>.md` with PROPOSED Section C blocks.
> **Never mutates `learnings.md` Section C — proposals only.** User pastes by hand.

## When to use

Weekly, before `pipeline-analysis`. Uses `src/performance.ts` (deterministic math)
and Section B of `knowledge/learnings.md`.

## Inputs

- `window_days` (default 7)

## Steps

1. **Run analytics:**
   ```
   npx tsx src/performance.ts --window <window_days>
   ```
   Surfaces:
   - Totals (touches, accepted [LinkedIn], replies, positive, negative)
   - `by_channel`, `by_skill`, `by_lead_status`, `by_crm_source`, `by_channel_x_skill`
   - `contrasts`: pairs that pass `MIN_BUCKET_SIZE=5` AND `MIN_DELTA=0.15`
2. **Read Section B:**
   ```
   npx tsx src/learnings.ts read --section B --limit 50
   ```
3. **Cross-reference:**
   - Does any Section B observation align with a numerical contrast?
   - Does any contrast lack a corresponding observation (unexpected)?
4. **Propose Section C blocks** where evidence ≥10 samples AND delta ≥ 15 pp:

```markdown
### C.<N> — <Rule name>

- **Evidence:** <window_days>d window — <N1> bucket vs <N2> others. Positive rate <P1>% vs <P2>% (delta <D> pp).
- **Rule:** <concrete, actionable directive>.
- **Why:** <one-sentence rationale>.
```

5. **Write report** to `output/performance/<YYYY-MM-DD>.md`:
   - Section: Totals
   - Section: Notable contrasts
   - Section: Proposed Section C blocks (paste-ready)
   - Section: Data warnings (low sample etc.)

6. **Print to terminal:** the proposed blocks only, ready for the user to review.

## End of run

Heartbeat: `performance-review: window=<X>d, touches=<N>, contrasts=<M>, proposed=<K>`.

## Does NOT do

- Does NOT edit `learnings.md` Section C — human-promotion only.
- Does not send anything or change tracker rows.
- Does not evaluate individual messages — only segment-level math.
