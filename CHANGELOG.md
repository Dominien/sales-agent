# Changelog

## [1.0.0] — 2026-04-12

### Initial release

- Unified multi-CRM sales agent. Picks one of: `sqlite` (no external CRM), `hubspot`, `close`, `attio`, `salesforce`.
- Two channels: `email` (Gmail MCP, draft-only) and `linkedin` (stickerdaniel/linkedin-mcp-server, autonomous send with rate-limiter guardrails).
- SQLite tracker as the local activity log (always present, even with an external CRM).
- Fit × engagement scoring → A/B/C/D tier.
- Performance feedback loop (Section A/B/C learnings + deterministic analytics).
- 10 composable skills, all CRM- and channel-agnostic.
- Interactive setup wizard (`npx tsx src/init.ts`).
- Migration path from `hubspot-email-agent` and `linkedin-sales-agent` progenitors.
