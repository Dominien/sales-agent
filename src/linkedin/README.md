# LinkedIn — in-repo TypeScript scrape commands

Replaces the external `stickerdaniel/linkedin-mcp-server` Python MCP. Skills invoke these CLI scripts directly via `Bash:` calls — no MCP server, no `claude mcp add`.

## Install

```bash
npm install
npx playwright install chromium     # rebrowser-playwright reuses Playwright's browser
```

## Login (one-time)

```bash
npx tsx src/linkedin/cli.ts login
```

Opens a headful Chromium window. Log in (2FA / CAPTCHA solved by you). On success the script:

- writes cookies to `~/.linkedin-mcp/cookies.json`
- writes session metadata to `~/.linkedin-mcp/source-state-ts.json`
- persists the Chromium profile under `~/.linkedin-mcp/profile-ts/`

> **Set your LinkedIn display language to English BEFORE logging in.** The scrape parses English UI labels.

The `cookies.json` is shared with the legacy `uvx linkedin-scraper-mcp` install — one login covers both.

## Verify session

```bash
npx tsx src/linkedin/cli.ts check
# → {"url":"https://www.linkedin.com/feed/","sections":{"check":"authed"},"status":"authed"}
```

If you get `{"status":"auth_required"}`, run `login` again.
If you get `{"status":"error","error":"rate_limited"}`, wait 15-30 minutes — LinkedIn temporarily throttled the IP.

## Commands

All commands take `--flag value` style args and print exactly one JSON object on stdout. Logs go to stderr.

### Tier 1 (used by every outreach skill)

```bash
npx tsx src/linkedin/cli.ts get-inbox --limit 20
npx tsx src/linkedin/cli.ts get-conversation --linkedin-username <username>
npx tsx src/linkedin/cli.ts get-conversation --thread-id <id>
npx tsx src/linkedin/cli.ts get-person-profile --linkedin-username <username> --sections experience,education,posts
npx tsx src/linkedin/cli.ts connect --linkedin-username <username> --note "≤300 chars"
npx tsx src/linkedin/cli.ts send-message --linkedin-username <username> --message "..." --confirm-send true
```

### Tier 2 (research / enrichment)

```bash
npx tsx src/linkedin/cli.ts search-people --keywords "Head of Engineering" --location Berlin
npx tsx src/linkedin/cli.ts search-jobs --keywords "TypeScript" --location Berlin --max-pages 2 --date-posted past_week
npx tsx src/linkedin/cli.ts get-company-profile --company-name acme --sections about,posts,jobs
npx tsx src/linkedin/cli.ts get-company-posts --company-name acme
npx tsx src/linkedin/cli.ts get-job-details --job-id 1234567890
```

## Result shape

```ts
type ToolResult = {
  url: string;
  sections: Record<string, string>;       // section name → innerText
  references?: Record<string, string>;    // text → href (anchor map)
  profile_urn?: string;                   // person profile only
  section_errors?: Record<string, string>;
  // write tools also:
  status?: string;          // "connected" | "pending" | "message_sent" | "send_failed" | ...
  sent?: boolean;
  note_sent?: boolean;
  message?: string;
  recipient_selected?: boolean;
  // search tools:
  job_ids?: string[];
};
```

## Exit codes

- `0` — success (`url` + `sections` populated)
- `1` — generic error (stdout has `{status:"error",error,detail?}`)
- `2` — auth required (stdout has `{status:"auth_required",message}`); skill should stop the loop and surface the message

## Architecture

```
cli.ts                  argv dispatcher
io.ts                   stdout/stderr helpers, parseFlags
types.ts                ToolResult contract
browser/launch.ts       launchPersistentContext + cookie bridge
browser/warmup.ts       google → wikipedia → github visits before LinkedIn
browser/selectors.ts    centralized DOM selectors
session/paths.ts        ~/.linkedin-mcp/{profile-ts,cookies.json,source-state-ts.json}
session/auth.ts         isLoggedIn, awaitLoggedIn, waitForManualLogin
session/cookies.ts      read/write cookies.json
scrape/page-helpers.ts  shared navigation + innerText helpers
scrape/<feature>.ts     per-command extractors
commands/<feature>.ts   thin command wrappers (auth check + emit)
```

Each invocation: spawns one Node process → opens Chromium against the persistent profile (cookies bridged from `cookies.json`) → warms up → does one thing → prints one JSON object → exits.

No long-running MCP server. No mutex (each call is its own process). Skills serialize via the existing rate-limiter contract (30-120s jittered sleep).

## Adding a new command

1. Add the scrape function in `scrape/<name>.ts`
2. Add the command wrapper in `commands/<name>.ts`
3. Wire it in `cli.ts` switch
4. Update this README

## DOM breakage

When LinkedIn changes the UI:

- All selectors live in `browser/selectors.ts` and inline at top of each `scrape/*.ts` file
- Run any command with the browser headed via setting `headless: false` in `browser/launch.ts` to debug
- `npx tsx src/linkedin/cli.ts check` is the smallest reproducer

## Rate limiting

LinkedIn throttles aggressively (HTTP 429 after 5-6 quick requests in a row). Skills must respect:

- Connection requests: ≤20/day, ≤80/week
- Direct messages: ≤40/day
- Jittered 30-120s sleep between any two LinkedIn commands

These caps live in `agent.config.json` and are enforced by `src/rate-limiter.ts` — the scripts themselves do NOT enforce them.
