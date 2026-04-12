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

## MCP prefix mapping

Skill files use a generic prefix (`mcp__linkedin__get_person_profile`). Your
harness may register servers under a different prefix. Substitute as needed:

| Generic (in skills) | Claude Code registered via `claude mcp add linkedin ...` |
|---|---|
| `mcp__linkedin__get_person_profile` | `mcp__linkedin__get_person_profile` |
| `mcp__gmail__gmail_create_draft` | `mcp__claude_ai_Gmail__gmail_create_draft` (if using Claude's hosted Gmail) OR `mcp__gmail__gmail_create_draft` (if self-registered) |
| `mcp__hubspot__search_crm_objects` | `mcp__claude_ai_HubSpot__search_crm_objects` OR harness-specific |

Function names after the prefix are stable.

## Setup checklist (Claude Code, SQLite + email)

1. `brew install node` (if missing)
2. Clone repo, `cd sales-agent`, `npm install`
3. `npx tsx src/init.ts` → choose `sqlite` + `email`
4. Make sure Claude Code has its Gmail MCP connected (`claude mcp list`)
5. From a Claude Code chat, paste a prompt from `prompts/invoke-skill.md`

## Setup checklist (Claude Code, full stack: HubSpot + email + linkedin)

1. System:
   ```bash
   brew install node uv
   ```
2. LinkedIn:
   ```bash
   uvx linkedin-scraper-mcp@latest --login   # one-time browser login
   claude mcp add linkedin --scope user --env UV_HTTP_TIMEOUT=300 \
     -- uvx linkedin-scraper-mcp@latest
   ```
3. HubSpot: connect via Claude Code's hosted OAuth (claude.ai HubSpot).
4. Repo: `npm install`, `npx tsx src/init.ts` → pick `hubspot` + `email,linkedin`
5. Invoke skills from prompts/invoke-skill.md.

## Optional Gmail fallback

If a contact has BOTH a LinkedIn URL AND an email address, `follow-up-loop`
will prefer the channel where there's already an active thread. Configure the
default in `agent.config.json` → `defaults.channel_priority`.
