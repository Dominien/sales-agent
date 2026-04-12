# Invoke-Skill Prompts

Copy-paste templates for any MCP-capable harness. Each prompt assumes
`CLAUDE.md`, `program.md`, the relevant `skills/*.md`, and `agent.config.json`
are loaded in context.

---

## cold-outreach (email)

```
Run the cold-outreach skill.
Channel: email.
Targets: <list of emails OR a CSV path>
Campaign tag: "COLD: <short-description>"
Max sends this run: 50
Mode: live
```

## cold-outreach (linkedin)

```
Run the cold-outreach skill.
Channel: linkedin.
Targets:
  - https://www.linkedin.com/in/example1
  - https://www.linkedin.com/in/example2
Campaign tag: "COLD: B2B SaaS HoG Berlin"
Max invites this run: 15
Mode: live

Follow CLAUDE.md rules strictly: 300-char invite note, one specific hook, no
selling, language match. Rate-limit check before every invite. Stop on 3
consecutive errors. Log every touch to tracker.db. Append one learnings entry
at the end.
```

## cold-outreach (preview)

```
Run cold-outreach in PREVIEW mode on the URLs above. Do not call
connect_with_person or gmail_create_draft. Instead write each draft message to
output/drafts/cold-<date>-<slug>.md with the rationale for each.
```

## cold-outreach (via search)

```
Run cold-outreach. Use mcp__linkedin__search_people with:
  { query: "Head of Growth", location: "Berlin", industry: "Computer Software" }
Take top 20 by relevance. Then standard loop. Max invites: 15.
```

---

## follow-up-loop

```
Run follow-up-loop.
Channel: auto (let config.defaults.channel_priority decide per contact).
stale_days: 10
tier_filter: A,B
max_per_run: 25
```

## follow-up-loop (linkedin-only, aggressive)

```
Run follow-up-loop, LinkedIn channel only. Target all CONNECTED contacts with
linkedin_last_message_at empty OR older than 14 days. Tier filter: A,B,C (wide
sweep). Max per run: 40 (the rate-limiter ceiling).
```

---

## inbox-classifier

```
Run inbox-classifier for the last 48 hours across all configured channels.
Auto-reply to POSITIVE_* on LinkedIn only. Email: draft replies only, user
reviews and sends.
```

---

## prospect-research

```
Run prospect-research.
Targets:
  - https://www.linkedin.com/in/example1
  - marcus@acme.com
  - https://www.linkedin.com/company/example-co
Audit type: go-to-market
Write dossiers to output/prospect-dossiers/. Update fit_score + priority_tier
in tracker.
```

---

## research-outreach

```
Run research-outreach.
Channel: linkedin (1st-degree connections only).
Targets (all already CONNECTED in tracker):
  - https://www.linkedin.com/in/example1
Use dossiers from output/prospect-dossiers/<slug>.md. Lead each message with
the single strongest hook. Max sends: 8.
```

---

## lead-recovery

```
Run lead-recovery.
stale_days: 21, tier_filter: A,B.
Write report to output/analysis/recovery-<today>.md.
No sends.
```

---

## compose-reply

```
Run compose-reply.
Identifier: marcus@acme.com  (or a LinkedIn URL or contact_id)
Channel: email

Extra context: "We had a discovery call last Tuesday. They mentioned evaluating
a switch from Tool X to Tool Y in Q3 but want to see our integration with Z first."

Compose a careful reply. Use Gmail history + LinkedIn conversation + CRM notes
+ the dossier if present + the context above. Save as a Gmail DRAFT and show
me the full text before I send.
```

---

## pipeline-analysis

```
Run pipeline-analysis with window_days=14. Write the full report to
output/analysis/pipeline-<today>.md. Print the summary block + recommended
next skill to terminal.
```

---

## performance-review

```
Run performance-review with window_days=7. Use src/performance.ts for the math
+ cross-reference Section B of knowledge/learnings.md. Propose Section C
blocks where evidence is ≥10 samples AND delta ≥ 15 pp. Write the full report
to output/performance/<today>.md.

Do NOT edit learnings.md Section C — just propose paste-ready blocks in the
report.
```

---

## contact-manager

```
contact-manager mode. I want to:
  - Mark marcus@acme.com as a hard no.
  - Add sarah@beta.com (Sarah Lee, Head of Growth at Beta Co, LinkedIn:
    https://www.linkedin.com/in/sarah-lee-hog), lead_status = NEW.
  - Rescore everyone in the tracker.

Confirm the exact CRM + tracker commands before running each one.
```

---

## init (one-time)

```
npx tsx src/init.ts
```

Wizard will prompt for CRM, channels, sender identity, and rate limits.
