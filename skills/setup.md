# Skill — setup

> **Mode:** one-shot conversational setup. Replaces `src/init.ts`.
> **Output:** writes `agent.config.json` + `.env` (from `.env.example`).

## When to use

Fresh clone, OR the user wants to change CRM / channels / sender identity /
rate limits. The user invokes `/setup` in Claude Code and you run this
skill end-to-end in chat.

## Contract

- Ask questions in chat, collect answers conversationally (you may batch 2–3
  related fields per message when that feels natural; don't machine-gun one
  question per turn).
- You MUST NOT invent values. If the user gives a vague answer, ask for
  clarification. The offering line especially deserves a probe — see below.
- When `agent.config.json` already exists: show the current values and ask
  whether to overwrite. If the user only wants to change a few fields, edit
  those fields via the `Edit` tool and skip the rest.
- After writing the config: DO NOT start the LinkedIn login or CRM OAuth
  yourself. Print the next-steps block and let the user run them.

## Flow

### 1. Detect prior state

Read `agent.config.json` if it exists. Summarize current values in one line:
"Existing config found — CRM: X, channels: [Y], sender.company: Z." Ask:
"Overwrite from scratch, edit specific fields, or cancel?"

### 2. CRM

Explain the options briefly:

- `sqlite` — no external CRM; tracker.db is the CRM. Fastest start.
- `hubspot` — HubSpot via hosted MCP (`mcp.hubspot.com/anthropic`)
- `close` — Close via hosted MCP (`mcp.close.com/mcp`)
- `attio` — Attio via hosted MCP
- `salesforce` — Salesforce via self-hosted MCP (sfdx)

Default: `sqlite`. Recommend `sqlite` unless they already use one of the others.

### 3. Channels

- `email` — Gmail drafts (the user reviews + sends)
- `linkedin` — autonomous invites + messages via the in-repo scraper,
  rate-capped

Ask which to enable. Default email.

### 4. Sender identity

Collect:

| Field | Notes |
|---|---|
| `sender.name` | Full name, no title prefix |
| `sender.email` | The From address for outbound |
| `sender.linkedin_url` | Full URL including `https://` (blank if no linkedin channel) |
| `sender.company` | Your company name |
| `sender.scheduling_link` | `https://cal.com/...` or equivalent. Blank if you prefer to offer specific windows manually. |
| `sender.offering` | 1–2 sentences: what you sell, who for — see below |

### Offering (give this extra care)

The `offering` line drives every cold message. If the user's first draft is
generic ("we help teams grow"), push back:

> That's too broad. Give me (a) who your customer is by title/team (VP Eng,
> RevOps lead, etc.), (b) the specific outcome you deliver, and (c) one
> proof — a metric, a named customer, a benchmark. I'll weave those in.

Example of a good offering:

> Integration-testing platform for B2B SaaS engineering teams — we cut
> QA-to-prod cycle time by 40% and ship 10+ tenants like Ramp and Deel.

### 5. Rate limits

Show defaults in chat. Ask: "Keep defaults or customize?" Most users keep
defaults.

Defaults:
- `email_draft.daily` = 200 (high because sales-agent typically emails more than job-agent)
- `linkedin_connect.daily` = 20, `weekly` = 80
- `linkedin_message.daily` = 40

### 6. Write config

Use the `Write` tool to create `agent.config.json`:

```json
{
  "crm": "sqlite",
  "channels": ["email"],
  "sender": {
    "name": "...",
    "email": "...",
    "linkedin_url": "",
    "company": "...",
    "scheduling_link": "",
    "offering": "..."
  },
  "rate_limits": {
    "email_draft": { "daily": 200 },
    "linkedin_connect": { "daily": 20, "weekly": 80 },
    "linkedin_message": { "daily": 40 }
  },
  "defaults": {
    "language": "auto",
    "channel_priority": ["email"],
    "tier_filter_default": ["A", "B"]
  },
  "crm_options": {}
}
```

Adjust `channel_priority` to `["linkedin", "email"]` if both channels are
enabled, or keep the chosen subset.

If `.env` doesn't exist and `.env.example` does, copy the example over.

### 7. Next steps

Print ONE compact block with the exact commands:

```
Next steps:

1. LinkedIn login (one-time) — if channels include linkedin:
     npx playwright install chromium   # browser binary
     npx tsx src/linkedin/cli.ts login  # headful; solve 2FA/CAPTCHA
     npx tsx src/linkedin/cli.ts check  # → {"status":"authed"}

2. CRM (one-time) — if you chose something other than sqlite:
     • HubSpot / Close / Attio: connect via your harness's Settings → Connectors
     • Salesforce: install sfdx CLI, authorize the org. See docs/crm-adapters.md

3. Gmail (if channels include email):
     Connect the Gmail MCP in your harness's settings UI.

4. Sanity check:
     npx tsx src/config.ts     # prints resolved config
     npx tsx src/tracker.ts read  # → [] on a fresh install

5. First skill run:
     See prompts/invoke-skill.md.
```

## Does NOT do

- Does not run `npx playwright install` or `npx tsx src/linkedin/cli.ts login`
  itself. Those are interactive + require 2FA in a real browser window.
- Does not touch the tracker DB or create CRM accounts.
- Does not install Gmail / HubSpot / Close MCPs (harness-specific OAuth flow).
- Does not edit `agent.config.example.json` — that's the template for new
  users, not the runtime config.
