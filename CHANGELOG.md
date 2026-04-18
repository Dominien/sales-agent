# Changelog

## [1.1.0] — 2026-04-18

Wave 1 retrospective hardening + data-model additions. No breaking changes;
existing `tracker.db` is migrated in place via `PRAGMA table_info`.

### Added

- **`do_not_contact` tracker column** with four canonical reasons
  (`bounce | unsubscribe | negative_hard | manual`). Auto-set by
  `inbox-classifier` on `BOUNCE`/`NEGATIVE_HARD`; honored by `cold-outreach`
  and `follow-up-loop` as a hard exclusion. Set manually via
  `tracker.ts skip <contact_id> <reason>`. See `knowledge/learnings.md` §A.4b.
- **`sender.timezone`** in `agent.config.json` (IANA string, e.g.
  `Europe/Berlin`). Used by `POSITIVE_MEETING` auto-replies and
  `compose-reply` when suggesting specific slots. Empty → skills fall back to
  a link-only variant. Setup wizard prompts for it.
- **`silent_reject` LinkedIn connect status**. Distinct from `send_failed`:
  returned when LinkedIn closes the invite dialog without transitioning to
  Pending (upsell modal, account-level throttle). Skills skip the contact
  without consuming a rate-limit slot and without counting toward the
  3-consecutive-error hard-stop.
- **One-shot auto-retry** in `performConnect` on transient DOM-timing
  failures (missing dialog, click-ineffective). 3 s backoff. Retry
  telemetry exposed via `retry_attempts` / `retry_reason` on the result.
- **`linkedin_connect_note` rate-limit action** with monthly window
  (default cap 5/month — LinkedIn free-tier personalized-note quota).
  Auto-falls-back to bare invites when exhausted; drafted note stays in
  `tracker.linkedin_connection_note` for post-accept DM delivery. No
  mid-batch user prompts.
- **`rate-limiter.ts saturate <action>`** — force a window counter to its
  cap (used to auto-exhaust the note quota on a silent note-drop).
- **`rate-limiter.ts reset <action> [day|week|month|all]`** — drop the
  counter for the current window (recovery from misrecords or tests).
- **`src/skip-flags.ts`** — tier classifier over `notes_summary` /
  `lead_status` / `reply_classification`. Three tiers: `hard` (never
  contact), `warm` (not now — owned by other rep / closed-lost / parked),
  `personal` (life-event pauses). English + German patterns.
- **`src/cohort-builder.ts`** + CLI — typed, deterministic outreach queue
  builder. Returns `{ included, excluded:[{row, reason}], totals }`. Skills
  call this once at the top of a run and log the exclusion summary to the
  learnings heartbeat. Replaces ad-hoc `tsx -e "..."` cohort-filtering.
- **`src/linkedin/match-validator.ts`** — post-search candidate scorer
  across surname uniqueness, firstname match, company token-Jaccard, and
  location overlap. Returns `confident | ambiguous | no_match` so skills
  can skip wrong-person top hits instead of sending to them.
- **`src/honorifics.ts`** — strips academic titles (`Dr.`, `Prof. Dr.`,
  `Dipl.-Ing.`, etc.) from the `firstname` field before rendering formal
  greetings. Prevents the "Herr Dr. Joachim Maiwald" double-render.
- **`knowledge/learnings.md` §C.1** — distilled rule: for bridge
  re-engagement after silence, prefer commercial *Verbleib* fragments over
  aesthetic / implementation details.
- **Cheat-sheet sections A.4b/c/d/e** documenting `do_not_contact`
  semantics, skip-flag tiers, the full LinkedIn connect-status taxonomy
  with rate-budget/error-count rules, and the note-quota fallback.

### Changed

- `skills/cold-outreach.md` — now calls `cohort-builder` up front, routes
  on the connect-status taxonomy, uses `match-validator` before sending,
  and references `honorifics` for formal German greetings.
- `skills/inbox-classifier.md` — sets `do_not_contact` on `BOUNCE` /
  `NEGATIVE_HARD`; `POSITIVE_MEETING` auto-reply uses `sender.timezone`.
- `skills/follow-up-loop.md` — always excludes rows where
  `do_not_contact != ''`.
- `skills/compose-reply.md` — `sender.timezone` injection for meeting
  proposals; `honorifics` helper for German formal greetings; bridge-hook
  rule referenced.
- `CLAUDE.md` — documents `sender.timezone`; `POSITIVE_MEETING` template
  uses `<sender.timezone>` with a link-only fallback.
- `agent.config.example.json` — includes `timezone` and
  `linkedin_connect_note` fields.

### Fixed

- Wave 1 Gap **G3**: LinkedIn silent-rejects no longer misclassify as
  `send_failed`, so they don't trigger the 3-consecutive-error hard-stop
  or consume rate budget.
- Wave 1 Gap **G4**: transient DOM-timing failures in `connect` now
  auto-retry once before being reported as errors.
- Wave 1 Gap **G5**: free-tier note-quota exhaustion no longer halts
  batches. Runs silently switch to bare invites; the note is queued for
  post-accept delivery.

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
