# Setup

End-to-end setup for every supported CRM × channel combination.

---

## Prerequisites (always)

```bash
# Node 18+
brew install node     # macOS. Linux/Windows: use your package manager.

# Clone + install
git clone <your-fork>/sales-agent && cd sales-agent
npm install
```

---

## Step 1 — Run the wizard

```bash
npx tsx src/init.ts
```

The wizard asks:

1. **CRM** — `sqlite` | `hubspot` | `close` | `attio` | `salesforce`
2. **Channels** — comma-separated subset of `email,linkedin`
3. **Sender identity** — name, email, LinkedIn URL, company, offering, scheduling link
4. **Rate limits** — accept defaults unless you have a specific reason

It writes `agent.config.json` + `.env` skeleton. Re-run anytime to change
choices.

---

## Step 2 — Channel setup

### Gmail channel (`channels` includes `email`)

Gmail tools are provided by the Gmail MCP server. In **Claude Code**: the
hosted `claude.ai Gmail` MCP is registered by default when you sign in. Verify:

```bash
claude mcp list | grep -i gmail
```

For other harnesses: register `@modelcontextprotocol/server-gmail` (or your
preferred Gmail MCP) per the harness's docs.

### LinkedIn channel (`channels` includes `linkedin`)

Uses [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server).

```bash
# 1. uv (runs the MCP server via uvx)
brew install uv

# 2. One-time browser login — stores ~/.linkedin-mcp/profile/
uvx linkedin-scraper-mcp@latest --login

# 3. Register with your harness (Claude Code shown)
claude mcp add linkedin --scope user --env UV_HTTP_TIMEOUT=300 \
  -- uvx linkedin-scraper-mcp@latest
```

If the login requires 2FA or CAPTCHA, solve in the browser window that opens.

**Important:** LinkedIn scraping may conflict with LinkedIn's Terms of Service.
The upstream MCP is marked for personal use only. You assume the risk.

---

## Step 3 — CRM setup

Pick your `crm` from the init wizard. Then follow the matching section below.

### crm = sqlite (default, zero setup)

Nothing to do. `tracker.db` is created on first tracker command:

```bash
npx tsx src/tracker.ts read    # → []
```

### crm = hubspot

**Claude Code:** connect the hosted `claude.ai HubSpot` MCP via the Settings UI
(OAuth flow).
**Other harnesses:** register the HubSpot MCP at `mcp.hubspot.com/anthropic`.

Custom contact property needed for LinkedIn URL tracking:

1. In HubSpot: **Settings → Properties → Contact properties → Create property**
2. Name: `linkedin_url`. Type: single-line text.
3. Save.

### crm = close

**Claude Code / other:** register the Close MCP at `mcp.close.com/mcp`.
Auth is OAuth 2.0 with Dynamic Client Registration. Scopes needed:
`mcp.read`, `mcp.write_safe` (if you want the agent to create/update records).

The agent treats a sales-agent `Contact` as a Close `Lead + primary Contact` pair.

### crm = attio

Register the Attio MCP per `docs.attio.com/mcp`. OAuth flow in your harness.

Workspace setup: make sure your Attio workspace has a `People` list (default).
If you use `listDeals`, have a `Deals` list too.

### crm = salesforce

Bigger lift — self-hosted MCP + Salesforce CLI.

```bash
# 1. Salesforce CLI
npm install -g @salesforce/cli

# 2. Authorize an org
sf org login web --alias default

# 3. Salesforce MCP server
npm install -g @salesforce/mcp

# 4. Register with harness (Claude Code shown — adjust for yours)
claude mcp add salesforce --scope user -- sf-mcp
```

Custom field needed for LinkedIn URL:
1. **Setup → Object Manager → Contact → Fields & Relationships → New**
2. Type: URL. Field Label: `LinkedIn URL`. API Name: `LinkedIn_URL__c`.
3. Save.

---

## Step 4 — Sanity checks

```bash
# Config resolves and validates
npx tsx src/config.ts

# Tracker bootstraps
npx tsx src/tracker.ts read

# Rate limiter responds
npx tsx src/rate-limiter.ts status

# Typecheck
npm run typecheck
```

All four should print cleanly (or return exit 0).

---

## Step 5 — First skill run

Copy a template from [`prompts/invoke-skill.md`](../prompts/invoke-skill.md) into
your harness chat. Recommended first run:

### With SQLite + email
Run `contact-manager` mode, add 1 test contact, then run `cold-outreach` in
PREVIEW mode on that contact. Verify a draft lands in `output/drafts/`.

### With HubSpot + email + linkedin
Run `prospect-research` on one LinkedIn URL that's already in HubSpot. Verify
the dossier lands in `output/prospect-dossiers/` and HubSpot's `linkedin_url`
field is populated.

---

## Troubleshooting

See [`docs/rate-limits.md`](rate-limits.md) for LinkedIn-flagging recovery.

**`claude mcp list` shows `✗ Failed to connect`** — the hosted server is up
but the harness couldn't reach it. Check your OAuth auth state; reconnect via
the Settings UI.

**`better-sqlite3` install fails on macOS** — `xcode-select --install`.

**LinkedIn MCP won't start** — run `UV_HTTP_TIMEOUT=300 uvx linkedin-scraper-mcp@latest --log-level DEBUG`
in the terminal to see the concrete error.

**"agent.config.json not found"** — you haven't run `npx tsx src/init.ts` yet.
