# Message Generation Rules — sales-agent

> **Start here:** read [`README.md`](README.md) for architecture + skills, then
> [`docs/setup.md`](docs/setup.md) for install.
> This file defines the **shared message-generation contract** that every
> outreach skill references.
>
> Named `CLAUDE.md` by convention, but the file is harness-agnostic. Every skill
> file in `skills/` links to these rules.

---

## Project context

Read the sender identity from `agent.config.json` → `sender`:
- `name`, `email`, `linkedin_url`
- `company`, `offering` — 1–2 sentence pitch
- `scheduling_link` — used in POSITIVE_MEETING replies

The skill MUST substitute these at compose time. Never hard-code.

---

## Tool paths

**CRM + Email — MCP (when used).** Tool names depend on how your harness
registered each server. Generic prefix convention used in skill files:

- `mcp__hubspot__*` (if `crm = hubspot`)
- `mcp__close__*`
- `mcp__attio__*`
- `mcp__salesforce__*`
- `mcp__gmail__*` (if `channels` includes `email`)

If your harness uses different prefixes, substitute. Function names after the
prefix stay the same.

**LinkedIn — in-repo CLI (no MCP server).** All LinkedIn ops shell out to:
- `npx tsx src/linkedin/cli.ts <command> [--flag value ...]`
- Commands: `login`, `check`, `daemon`, `get-inbox`, `get-conversation`, `get-person-profile`, `connect`, `send-message`, `search-people`, `search-jobs`, `get-company-profile`, `get-company-posts`, `get-job-details`
- Returns one JSON object on stdout. Exit 2 = `auth_required` (skill must stop and surface). Exit 1 = error (includes `rate_limited`).
- See `src/linkedin/README.md` for details and examples.

**Local CLIs (always available):**

- `npx tsx src/tracker.ts` — contact + reply + status
- `npx tsx src/scoring.ts` — fit × engagement → tier
- `npx tsx src/rate-limiter.ts check|record|status` — mandatory before sends
- `npx tsx src/performance.ts` — deterministic analytics
- `npx tsx src/learnings.ts append|read` — feedback log
- `npx tsx src/config.ts` — print resolved config

**Local CLIs also for `crm=sqlite`:** tracker + notes + tasks + deals all local.

---

## The rate-limit contract (NON-NEGOTIABLE)

Before every `send_message`, `connect_with_person`, or `gmail_create_draft`:

1. `npx tsx src/rate-limiter.ts check <email_draft|linkedin_connect|linkedin_message>`
2. If exit code ≠ 0 → **stop** the loop immediately, append a heartbeat explaining why, exit.
3. After a successful action: `npx tsx src/rate-limiter.ts record <action>`.
4. Jittered sleep 30–120 s before the next action.
5. 3 consecutive errors from `connect_with_person` → hard-stop, append observation, exit.

If a LinkedIn CLI command exits with code 2 (`{"status":"auth_required"}`):
the daemon will already have auto-popped a login window. Stop the loop,
notify the user to sign in there, and wait. Once they're done, the next
command auto-respawns the daemon with the new session.

If a command returns `{"status":"error","error":"rate_limited"}`: stop the
loop, append a heartbeat, exit. LinkedIn typically clears 429 within 15-30
minutes of zero traffic.

---

## Email message rules (`gmail_create_draft`)

- **Length:** 5–7 sentences max.
- **Subject:** project- or company-specific. Not "Follow-up" or "Quick question."
- **Hook:** connect to something specific — last note (CRM), last thread
  (Gmail), recent company post. Not generic.
- **CTA:** one concrete question or calendar link — never vague.
- **Tone defaults by lead_status** (applies across CRMs):

| `lead_status` | Greeting | Tone | Focus |
|---|---|---|---|
| CONNECTED / WARM | First name | Casual, direct | Pick up from last contact |
| ATTEMPTED_TO_CONTACT / COLD | Formal | Professional | Re-establish relevance |
| UNQUALIFIED | Formal | Professional | Door open, no pressure |
| NEW | Formal | Professional | Introduction |
| IN_PROGRESS / OPEN_DEAL | First name | Direct | Move it forward |
| BAD_TIMING | Formal | Professional | Check-in when timing shifts |
| (none) | Formal | Neutral | General inquiry |

- **Greeting override by profession:** use formal even for CONNECTED when:
  - Conservative industry (law, medicine, finance, notary, insurance, bank)
  - Profile/age signals traditional (title "Dr./Prof.", owner-run SME)
  - German profile with no casual signals → `Sie`
  - No documented casual contact in CRM notes or thread

- **Signature:**
  - Casual: `Best,\n<sender.name>\n<sender.company>`
  - Formal: `Kind regards,\n<sender.name>\n<sender.company>`

---

## LinkedIn invite note rules (`connect_with_person`)

- **≤ 300 characters** (LinkedIn hard limit).
- **Exactly one specific hook** per `knowledge/research-config.md` priority:
  recent post, recent role change, named company initiative, shared (named)
  connection.
- **No pitch** in the invite. Door-opening only.
- **One CTA** — usually "would love to connect" or a narrow question.
- **Language matches profile.**
- **Skip** if no hook exists. Move on.

### Note-quota fallback (free-tier LinkedIn)

LinkedIn free tier caps personalized invites at ~5/month. Once exhausted,
the "Add a note" UI disappears and the CLI may return a bare-send result
(`status: "connected"` with `note_sent: false`). Skills MUST:

1. Treat `status: "connected"` with `note_sent: false` as a successful
   send — count it against `linkedin_connect`, do not retry.
2. Store the drafted hook in `tracker.linkedin_connection_note` anyway,
   and deliver it as the FIRST `send_message` once the invite is accepted.
3. Do NOT abort the batch on `note_not_supported`. Continue the loop.

Only `status: "send_failed"` (or `auth_required` / `rate_limited`) count
against the 3-consecutive-error hard-stop.

### Good example (278 chars)

```
Hi Sarah — your post about scaling the data team 3 → 12 in 18 months landed.
I work with GTM leaders on ramping new hires faster and would love to swap
notes with someone who's actually done it at that pace.
```

### Bad (DO NOT do this)

```
Hi Sarah, I'd love to connect to explore synergies.
```

---

## LinkedIn message rules (`send_message` — 1st-degree only)

- **3–6 sentences.** Shorter than email.
- **Hook from last thread** (use `get_conversation` first) or from profile/posts.
- **One concrete CTA** (yes/no question or calendar link).
- **Tone slightly more formal** than email. LinkedIn's context is professional.
- **No attachments / no links on the first message** unless the reader asked.
- **No signature** — LinkedIn shows your name automatically.

---

## CRITICAL RULES

1. **Never invent details.** If the CRM / profile doesn't mention it, don't
   reference it. A generic but honest line beats a fabricated personal one.
2. **Log every send immediately.** Call the tracker + CRM note writers
   before moving on. On write-failure: STOP, surface the error.
3. **Rate-limiter check before every action.** No exceptions.
4. **One language per message.** Never mix.
5. **Append a learnings entry at the end of every skill run** — heartbeat OR observation.
6. **Email is DRAFT-ONLY.** The agent writes drafts; the user sends them.
7. **Section C of learnings.md is human-owned.** Skills propose, user promotes.

---

## Example messages

### CONNECTED + casual (email)

```
Subject: Your platform rollout — any updates?

Hey Simon,

we had a call planned for late March about your platform — you said you
were pushing to early April. Wanted to check if you've made progress or
if we should pick up the integration discussion again.

Do you have 20 minutes this week for a quick call?

Best,
<sender.name>
<sender.company>
```

### ATTEMPTED_TO_CONTACT + formal (email)

```
Subject: <Company> — quick follow-up

Hello Mr. Smith,

you had expressed interest in our services around <topic from notes>. I
wanted to check if the need is still live, or if things have changed.

If useful, I'm happy to schedule a short call.

Kind regards,
<sender.name>
<sender.company>
```

### POSITIVE_MEETING auto-reply (LinkedIn)

```
Happy to hear that, Marcus. I have Tuesday 10:00 and Thursday 15:00 CET
open — which works better? If neither, here's my link:
<sender.scheduling_link>.
```

### Soft-negative reply (email, draft only)

```
Subject: Re: <original subject>

No rush at all, Marcus — thanks for the honest note. I'll ping again in Q3.
If anything shifts earlier, you know where to find me.

Best,
<sender.name>
```
