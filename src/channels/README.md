# Channels

A channel is a way to reach a contact. v1 ships two:

| Channel | MCP server | Outbound | Rate-limit action |
|---|---|---|---|
| `email` | `mcp__gmail__*` | `gmail_create_draft` (draft-only, user sends) | `email_draft` (200/day soft cap) |
| `linkedin` | `mcp__linkedin__*` (stickerdaniel/linkedin-mcp-server) | `connect_with_person` (invite) + `send_message` (DM) | `linkedin_connect` (20/day, 80/week) + `linkedin_message` (40/day) |

## How channels work

Like CRM adapters, channels are a TypeScript contract, not a runtime HTTP client.
Actual MCP tool calls happen from inside your harness (Claude Code / Cursor / etc.)
at skill-execution time. This folder provides:

1. **The `Channel` interface** — the contract skills reference.
2. **MCP tool mappings** — `GMAIL_MCP_MAPPING` and `LINKEDIN_MCP_MAPPING` constants
   document the exact MCP tool name + argument shape for each channel operation.
3. **Type-safe OutboundMessage / InboundMessage types** — so skills and other
   code can pass messages around in Node without ambiguity.
4. **SQLite adapter integration** — the tracker columns that each channel uses
   (`email_*`, `linkedin_*`).

## Adding a channel (e.g., Outlook, Slack DM)

1. Create `src/channels/<name>.ts` exporting `create<Name>Channel(): Channel`.
2. Add `'<name>'` to the `ChannelName` union in `channel.ts`.
3. Add a case in `loadChannel()`.
4. Define a `<NAME>_MCP_MAPPING` const documenting the provider's MCP tools.
5. Add tracker columns if the channel needs its own state (e.g. a
   `slack_last_dm_at` column via a db.ts migration).
6. Add a rate-limit key in `rate-limiter.ts` if the provider has relevant limits.
7. Document in `docs/channels.md`.

## Why draft-only for email but send for LinkedIn?

- **Email is personal.** Gmail sits in front of your reputation with every
  recipient. Drafts let you review every word before it goes out.
- **LinkedIn is rate-limited to safety.** Auto-sending within strict caps (20
  invites/day) keeps volume safe, and "draft for review" would destroy the
  skill's autonomy loop. The rate-limiter is the safety mechanism instead.

Both defaults are overridable: set `asConnectionNote: true` on a LinkedIn
OutboundMessage to send as invite-note instead of DM; configure a future
Outlook channel as send-direct if you want.
