# Rate Limits

The rate-limiter is the difference between a working account and a restricted
one. Especially on LinkedIn. These defaults exist because people got flagged.

## Defaults

Set in `agent.config.json` → `rate_limits` (or edited in `src/rate-limiter.ts`).

| Action | Daily | Weekly | Monthly | Notes |
|---|---|---|---|---|
| `email_draft` | 200 | — | — | Sanity cap. Drafts still need human review. |
| `linkedin_connect` | 20 | 80 | — | LinkedIn flags at ~100/week |
| `linkedin_message` | 40 | — | — | Account-level suspicion threshold |
| `linkedin_connect_note` | — | — | 5 | LinkedIn free-tier personalized-note quota. Auto-saturates on silent note drops; skills continue with bare invites + queue the drafted note for post-accept DM. |

LinkedIn's community-reported thresholds:
- **> 100 invites/week:** warning banner in the UI
- **> 150–200/week:** invite-sending temporarily disabled for ~1 week
- **Repeated offense:** permanent restriction on the account

Our defaults sit **~20% below** the first threshold. Don't raise them without
a calibration run on a low-value account first.

## Additional safety rails (enforced by skills, not the rate-limiter)

- **30–120 s jittered sleep** between consecutive actions.
- **Hard-stop on 3 consecutive `send_failed` errors** from `connect`. The
  `silent_reject`, `follow_only`, `connect_unavailable`, and ambiguous
  match-validator verdicts do NOT count — see the status taxonomy in
  `knowledge/learnings.md` §A.4d.
- **One-shot auto-retry** on transient `send_failed` reasons (missing
  dialog, click-ineffective). 3 s backoff. Controlled by
  `TRANSIENT_FAILURE_PATTERNS` in `src/linkedin/scrape/connect.ts`.
- **Session-expired detection:** if the CLI returns exit 2 (`auth_required`),
  the daemon already auto-popped a login window; the skill stops and
  surfaces. No silent retries.
- **Run skills sequentially, not in parallel.** Parallel runs stack load on
  the same session and trip anti-automation detection.

## How the rate-limiter works

Stores counters in the `rate_state` table of `tracker.db`:

```
action_type         window_key       count  last_action_at
linkedin_connect    day:2026-04-12   7      2026-04-12T11:04:12Z
linkedin_connect    week:2026-W15    18     2026-04-12T11:04:12Z
linkedin_message    day:2026-04-12   12     2026-04-12T10:58:01Z
email_draft         day:2026-04-12   45     2026-04-12T10:58:01Z
```

`check` reads day + week counters and compares against `LIMITS` (sourced from
`agent.config.json` → `rate_limits`). Returns exit code 0 (ok) or 1 (blocked).

`record` increments both day and week counters (week only for actions with
weekly caps).

Inspect current state:

```bash
npx tsx src/rate-limiter.ts status
```

Counters automatically reset at day-key / week-key / month-key rollover —
no manual work.

Optional hygiene: prune day counters older than 60 days (weekly + monthly
rows stay):

```bash
npx tsx src/rate-limiter.ts prune
```

### Recovery commands

Two corrections are available when the counter state diverges from reality:

```bash
# Force a counter to its cap. Used automatically when a LinkedIn note is
# silently dropped (free-tier quota exhausted) — the remaining batch then
# auto-falls-back to bare invites for the rest of the month.
npx tsx src/rate-limiter.ts saturate linkedin_connect_note

# Clear the current window's counter. Scope defaults to `all`
# (day + week + month). Useful after aborted runs or integration tests.
npx tsx src/rate-limiter.ts reset linkedin_connect_note month
```

## What to do if LinkedIn flags you

1. **Stop all outreach immediately.** No more LinkedIn CLI calls.
2. **Stop the daemon and wipe the local session:**
   ```bash
   npx tsx src/linkedin/cli.ts daemon stop
   rm -rf ~/.linkedin-mcp/profile-ts ~/.linkedin-mcp/cookies.json ~/.linkedin-mcp/source-state-ts.json
   ```
3. **Wait 24–48 h.** Do not touch the account programmatically.
4. **Log in manually in a real browser.** Do some normal human activity —
   scroll your feed, react to 5 posts, comment once. This "cools down" the
   behavior score.
5. **After 48 h:** re-run `npx tsx src/linkedin/cli.ts login`. **Halve your limits** (10 invites/day, 40/week, 20 messages/day) for one week. Watch the
   `status` daily.
6. **After the week:** if nothing re-flags, restore defaults. If flagged again,
   lower permanently.
7. **If the account is restricted** (invites disabled, connection requests
   auto-deny): wait it out. Do NOT create a new account from the same IP /
   device fingerprint — LinkedIn links them.

## Tuning limits

Edit either:
- `agent.config.json` → `rate_limits` (per-project) — recommended
- `HARD_DEFAULTS` in `src/rate-limiter.ts` (source-level) — for the fallback when config isn't loadable

Document any change in `knowledge/learnings.md` Section C with an explicit
rationale. Re-run `performance-review` weekly to verify no acceptance-rate
regression.

## What the rate-limiter does NOT guard against

- **Profile views** — `get_person_profile` opens the profile in the browser.
  High view counts (500+/day) are a red flag. Keep cold research proportional
  to your cold-outreach volume (~1:1).
- **Search volume** — `search_people` with expensive filters looks automated
  if repeated in a short window. Don't run 10 searches back-to-back.
- **Rapid UI actions across skills** — if you run `cold-outreach` and
  `follow-up-loop` concurrently, actions stack. The rate-limiter's state is
  shared, but the MCP's browser session load isn't. Serialize.
