# Scoring Config

Drives `src/scoring.ts`. Code defaults match this doc — keep them aligned.

---

## ICP — customize this section

Replace the placeholders with your actual ideal-customer profile. The scoring
code reads profile data (industry, title, company size, location) and awards
partial credit; swap the heuristics for explicit lists when you've calibrated.

### Industry fit (0–30 pts in `computeFit`)

| Tier | Points | Examples |
|---|---|---|
| High fit | 30 | (fill in, e.g. B2B SaaS, agencies, e-commerce) |
| Medium fit | 20 | (e.g. consulting, fintech, marketplaces) |
| Low fit | 5 | (e.g. traditional retail, heavy industry) |
| Unknown | 5 | blank industry |

Current default implementation: 20 pts for any known industry, 5 for blank.
Upgrade by editing `computeFit` with an explicit industry match table.

### Company size (0–25 pts)

| Employees | Points | Notes |
|---|---|---|
| 10–200 | 25 | Sweet spot (default) |
| 1–9 | 15 | Small |
| 201–1000 | 15 | Medium-large |
| 1000+ | 10 | Enterprise |
| Unknown | 8 | |

### Title / headline keywords (0–30 pts)

| Pattern (regex, lowercase) | Points |
|---|---|
| `ceo\|founder\|co-founder\|owner\|geschäftsführer\|inhaber\|managing director\|cto\|coo\|cmo\|cfo` | 30 |
| `vp\|vice president\|director\|head of\|leiter\|partner` | 22 |
| `manager\|lead\|teamlead\|team lead\|principal` | 15 |
| other | 5 |
| blank | 10 |

### Location (0–15 pts)

Any known location: 10. Blank: 5. Override in `computeFit` if you sell regionally.

---

## Engagement model (0–100)

Applied to every tracker row via `computeEngagement`:

| Signal | Delta |
|---|---|
| `linkedin_connection_status = CONNECTED` | +20 |
| `linkedin_connection_status = REQUEST_SENT` | +5 |
| `linkedin_connection_status = DECLINED` | −15 |
| Reply classification `POSITIVE_*` | +40 |
| Any non-hard-negative reply | +15 |
| Reply within 30 days | +15 |
| Reply within 90 days | +10 |
| We've reached out (email drafted OR LinkedIn messaged) | +5 |
| `status ∈ {sent, drafted}` | +5 |
| `notes_summary` starts with `RES:` | +10 |
| `notes_summary` starts with `COMPOSE:` | +5 |
| `reply_classification = NEGATIVE_HARD` | −20 |
| `reply_classification = BOUNCE` | −30 |

Clamped to [0, 100].

---

## Priority tier matrix

| Fit \ Engagement | Low (0–30) | Medium (31–60) | High (61–100) |
|---|---|---|---|
| **Low (0–40)** | D | C | B |
| **Medium (41–70)** | C | B | A |
| **High (71–100)** | B | A | A |

- **A:** act first. Cold + follow-up priority queue.
- **B:** batch weekly.
- **C:** nurture / watch-list only.
- **D:** skip unless running a D-tier experiment.

---

## Rate limits

Set in `agent.config.json` → `rate_limits`. Defaults:

| Action | Daily | Weekly | Why |
|---|---|---|---|
| `email_draft` | 200 | — | Sanity cap |
| `linkedin_connect` | 20 | 80 | LinkedIn flags at ~100/week |
| `linkedin_message` | 40 | — | Account-level suspicion |

Document any change in `learnings.md` Section C with explicit rationale.

Additional safety rails enforced by skills (not the rate-limiter):
- 30–120 s jittered sleep between consecutive actions
- 3 consecutive errors on `connect_with_person` → hard-stop, observation
- Run skills **sequentially**, not in parallel — parallel runs stack load on the same LinkedIn session
