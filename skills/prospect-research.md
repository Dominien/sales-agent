# Skill — prospect-research

> **Mode:** one-shot per list. Research only — NO sends.
> **Channels used:** whichever `config.channels` includes. LinkedIn is strongly preferred for profile depth.

## When to use

Before a high-stakes touch. Produces a dossier per target in
`output/prospect-dossiers/<slug>.md` and updates `fit_score` + `priority_tier`
in the tracker. Feeds `research-outreach`, `cold-outreach`, `compose-reply`.

## Inputs

- List of identifiers (LinkedIn URLs, emails, or company domains)
- `audit_type` (default `go-to-market`; see `knowledge/research-config.md`)

## Loop

For each target:

1. **Determine target type:**
   - `https://www.linkedin.com/in/...` → person
   - `https://www.linkedin.com/company/...` → company
   - `@company.com` email → person (also run company audit)
   - bare domain → company

2. **Collect data** (use whichever channels are enabled):
   - **Person:** `npx tsx src/linkedin/cli.ts get-person-profile --linkedin-username <user> --sections experience,education,posts,certifications,honors`
   - **Company:** `npx tsx src/linkedin/cli.ts get-company-profile --company-name <slug> --sections about,posts,jobs` plus `get-company-posts --company-name <slug>`
   - **Fallback / enrichment:** `WebFetch` on the company domain for messaging, products, team page
   - **If CRM is external:** `crm.searchContacts({email})` + `crm.listNotes(id)` to pull existing internal context

3. **Write dossier** to `output/prospect-dossiers/<slug>.md` per the template in
   `knowledge/research-config.md`. Include:
   - Identity (name, role, tenure, location)
   - Career arc (one line)
   - Company snapshot (industry, size, recent posts/news)
   - 3 personalization-hook candidates (ranked)
   - ICP fit score (0–100) with breakdown
   - Open risks / awkwardness flags

4. **Score:** `scoring.ts score <contact_id> --data '<json>'` with the profile data.

5. **Upsert tracker:** update `fit_score`, `priority_tier`, identifying fields.

## End of run

Heartbeat: `prospect-research: <N> dossiers, <A> tier-A, <B> tier-B, <unreachable>`.

## Does NOT do

- No outreach.
- No CRM writes beyond upserting the contact (if needed).
- No repeat of an existing dossier if `output/prospect-dossiers/<slug>.md` already exists within the last 30 days (skip with reason).
