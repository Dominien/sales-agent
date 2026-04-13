# Channels

One file per channel in `src/channels/`. Each implements the `Channel` interface
(`src/channels/channel.ts`) and documents its `_MCP_MAPPING`.

## Shipped in v1

### Email (Gmail)

**File:** `src/channels/gmail.ts`
**MCP prefix:** `mcp__gmail__*`
**Outbound semantics:** **DRAFT-ONLY.** `gmail_create_draft` writes a draft.
The user reviews + sends in Gmail UI.
**Rate-limit key:** `email_draft` (default 200/day — soft cap against runaway
drafting, not against Google's own anti-spam).
**Inbound:** `gmail_search_messages({query: "newer_than:Xd in:inbox"})` +
`gmail_read_thread`.

**Setup — Claude Code:** `claude.ai Gmail` MCP is connected by default when
you sign in. Verify with `claude mcp list`.

**Setup — other harnesses:** register an Gmail MCP of your choice. The
`gmail_create_draft` + `gmail_search_messages` + `gmail_read_thread` + `gmail_read_message`
tool names are the de-facto standard.

### LinkedIn

**Adapter:** `src/channels/linkedin.ts` (CLI mapping; no MCP)
**Implementation:** in-repo TypeScript at `src/linkedin/cli.ts` — see [`src/linkedin/README.md`](../src/linkedin/README.md).
**Outbound semantics:** **autonomous with strict rate-limits.** The skill
loops through targets, enforces rate-limiter check + record, sleeps with
jitter.
**Rate-limit keys:** `linkedin_connect` (20/day, 80/week) + `linkedin_message`
(40/day).

**Setup:**
```bash
npm install
npx playwright install chromium
npx tsx src/linkedin/cli.ts login        # one-time interactive
npx tsx src/linkedin/cli.ts check        # verify session
```

> Set your LinkedIn UI language to **English** before logging in — the scraper
> parses English labels.

A long-lived daemon process holds one warm Chromium across calls (~30s cold
spawn, then <1s per command). Cookies live in `~/.linkedin-mcp/cookies.json`,
profile in `~/.linkedin-mcp/profile-ts/`. Session typically lives ~2-4 weeks;
when it expires the next command auto-pops a login window.

**ToS note:** LinkedIn automated browsing is a grey area. Personal use only.
You assume the risk.

---

## Design principles

### Draft-only for email, autonomous for LinkedIn

- **Email is personal.** Gmail sits in front of your reputation with every
  recipient. Drafts let you review every word.
- **LinkedIn is rate-limited to safety.** Autonomous send within tight caps
  keeps the feedback loop fast. Draft-for-review would destroy the loop.

Both defaults are overridable. You can:
- Override the LinkedIn channel to draft-only by editing your skill invocation
  to run `preview` mode.
- (Future) override the email channel to send-direct by implementing a
  `gmail_send_message` path — not shipped because we don't recommend it.

### Channels don't touch the tracker

Channels only do send/receive. The skill owns the tracker write. Keeps
responsibilities clean.

---

## Adding your own channel

Pattern:

```ts
// src/channels/outlook.ts
import type { Channel } from './channel.ts';

export function createOutlookChannel(): Channel {
  return {
    name: 'outlook' as any,    // add to ChannelName union
    async outbound(msg) { /* call mcp__outlook__create_draft ... */ },
    async readInbox(since) { /* ... */ },
    async readThread(id) { /* ... */ },
  };
}

export const OUTLOOK_MCP_MAPPING = { /* tool + argsFrom per operation */ } as const;
```

1. Add `'outlook'` to `ChannelName` union in `channel.ts`.
2. Add a `case 'outlook':` to `loadChannel()`.
3. Add tracker columns if the channel needs its own state (migrate `db.ts`).
4. Add a rate-limit key in `src/rate-limiter.ts` if the provider has limits.
5. Document here. Add skill examples to `prompts/invoke-skill.md`.

## Channels we've considered but not shipped

- **Outlook** — Microsoft Graph MCP exists. Same DRAFT-ONLY semantics as Gmail recommended.
- **Slack DM** — `modelcontextprotocol/servers/slack` works. Autonomous send with channel-specific rate limits.
- **SMS / WhatsApp** — several third-party MCPs. Strict regulatory exposure — start draft-only.
- **Twitter/X DM** — no official MCP yet; community ones exist but API access is restricted.

All are 1–2 days of work per channel.
