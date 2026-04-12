# Research Config

Drives `prospect-research` and `research-outreach`. Customize per your offer.

---

## Profile dossier template (for a person)

Written to `output/prospect-dossiers/<slug>.md`:

```markdown
# <First Last> — <Company>

**Profile:** <linkedin_url or email>
**Headline:** ...
**Location:** ...
**Seniority:** C-suite / VP / Director / Manager / IC
**Tenure at current company:** X years Y months
**Recent activity (last 30 days):** 3 most recent posts (date + topic + engagement)
**Career arc (1 line):** e.g. "scaled the data org 10 → 120 across 3 companies"
**ICP fit score (0–100):** ... → tier X
**Personalization hook candidates (ranked):**
  1. [hook + 1-sentence explanation of why it works]
  2. ...
  3. ...
**Open risks / awkwardness flags:** (e.g., recently restructured, PR issue)
```

## Company dossier template

```markdown
# <Company>

**Page:** <linkedin_url or domain>
**Industry:** ... | **Size:** ... | **HQ:** ...
**Website:** (if distinct)
**Recent posts (last 30 days):** 3 most recent with engagement
**Hiring velocity:** roles posted this quarter (from search_jobs or WebFetch)
**Growth signals:** funding, leadership changes, product launches
**ICP fit (0–100):** ... → tier X
**Talking points:** 3 bullets a seller can lead with
```

---

## Audit types (pick ONE per campaign — set in the skill invocation)

| Type | Compared against | Frame |
|---|---|---|
| `go-to-market` | Your POV on their GTM motion | "You're targeting X; we've helped Y teams do Z" |
| `tech-stack` | Inferred stack from job postings | "You just posted a Snowflake role — we help teams onboard analysts 3× faster" |
| `hiring-velocity` | Recent role counts | "You're hiring 5 AEs — we help ramp in 30 days" |
| `content-cadence` | Post frequency + themes | "Your posts on X have 10× engagement — here's how to convert that into pipeline" |
| `competitive` | vs 2 named competitors | "I saw Tool Y; 3 of your peers switched to X for Z reason" |

Default: `go-to-market` (most general).

---

## Personalization hook priority (highest → lowest)

1. **Recent post (last 14 days)** — highest signal of openness to a conversation
2. **Job change / promotion (last 90 days)** — congratulations angle
3. **Named company initiative mentioned in company posts**
4. **Shared connection with a mutual that will actually vouch**
5. **Alma mater / bootcamp / cert** — lowest priority, only when nothing else

**Never** use:
- "I came across your profile" (no hook)
- "I see you work in <industry>" (generic)
- "Your background is impressive" (flattery)
- "We have mutual connections" without naming the connection
