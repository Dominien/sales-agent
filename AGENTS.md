# Agent Harness Compatibility

sales-agent runs on any harness that supports MCP (Model Context Protocol) and
can execute shell commands (for the local CLIs).

## Supported harnesses

- **Claude Code** — primary target. Tested.
- **Cursor** — MCP support stable.
- **Continue** — MCP support stable.
- **Windsurf / Zed** — MCP-capable IDE agents.
- **Custom Python / Node agents** — anything that can speak MCP stdio + run shell.

## What your harness needs

1. **MCP client** — to call CRM and channel MCP servers.
2. **Shell execution** — to run `npx tsx src/*.ts` for tracker / scoring / rate-limiter / learnings.
3. **File read/write** — to read `agent.config.json` + `skills/*.md` and write outputs to `output/`.

If your harness is missing any of these, sales-agent won't work — fall back
to whichever piece is needed (e.g., an agent without MCP could only run in
`sqlite` mode with email disabled, which isn't useful).

## MCP prefix mapping (CRM + email only)

LinkedIn no longer uses MCP — it ships as in-repo TypeScript at
`src/linkedin/cli.ts` which the skills shell out to with `npx tsx`. CRM and
email channels still use MCP. Skill files use a generic prefix; substitute if
your harness registers servers under different names:

| Generic (in skills) | Claude Code's hosted equivalent |
|---|---|
| `mcp__gmail__gmail_create_draft` | `mcp__claude_ai_Gmail__gmail_create_draft` |
| `mcp__hubspot__search_crm_objects` | `mcp__claude_ai_HubSpot__search_crm_objects` |

Function names after the prefix are stable.

## Setup checklist (Claude Code, SQLite + email)

1. `brew install node` (if missing)
2. Clone repo, `cd sales-agent`, `npm install`
3. `npx tsx src/init.ts` → choose `sqlite` + `email`
4. Make sure Claude Code has its Gmail MCP connected (`claude mcp list`)
5. From a Claude Code chat, paste a prompt from `prompts/invoke-skill.md`

## Setup checklist (Claude Code, full stack: HubSpot + email + linkedin)

1. System: `brew install node`
2. Repo: `npm install`, then `npx playwright install chromium`
3. LinkedIn:
   ```bash
   npx tsx src/linkedin/cli.ts login        # one-time interactive login
   npx tsx src/linkedin/cli.ts check        # verify session
   ```
4. HubSpot: connect via Claude Code's hosted OAuth (claude.ai HubSpot).
5. Wizard: `npx tsx src/init.ts` → pick `hubspot` + `email,linkedin`
6. Invoke skills from prompts/invoke-skill.md.

## Optional Gmail fallback

If a contact has BOTH a LinkedIn URL AND an email address, `follow-up-loop`
will prefer the channel where there's already an active thread. Configure the
default in `agent.config.json` → `defaults.channel_priority`.
