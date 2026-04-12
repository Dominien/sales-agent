# Skill — contact-manager

> **Mode:** conversational. CRUD on contacts / notes / tasks / deals.
> **Works with any CRM.** All operations go through `crm.*` adapter methods +
> mirror into the local tracker.

## When to use

Manual edits: add a contact the agent hasn't seen, fix a row, mark something
as closed, re-tier by hand, import a CSV. Replaces both progenitor agents'
`crm-manager` and `contact-manager` skills.

## Allowed operations

### Contacts
- **Search:** `crm.searchContacts({email | linkedin_url | query})` → list
- **Get:** `crm.getContact(id)` → single row
- **Create / update:** `crm.upsertContact({...})` → then `tracker.ts upsert --json '{crm_source, crm_id, ...}'`
- **Status change:** `crm.setLeadStatus(id, status)` + mirror to tracker

### Notes
- **List:** `crm.listNotes(contactId)`
- **Add:** `crm.addNote(contactId, body)` — also appends a summary line to
  tracker `notes_summary` if shorter than 140 chars

### Tasks (if `crm.createTask` is implemented)
- **Create:** `crm.createTask({contact_id, title, due_date, note})`
- **List:** `crm.listTasks({contact_id | status})`

### Deals (if `crm.listDeals` is implemented)
- **List:** `crm.listDeals({contact_id | stage})`
- **Upsert:** `crm.upsertDeal({...})`

### Scoring overrides
- **Manual score:** `scoring.ts update <contact_id> <fit> <eng>` — recomputes tier
- **Bulk rescore:** `scoring.ts score-tracker`

### Tracker admin
- **Mark reply classification:** `tracker.ts reply <contact_id> <email|linkedin> <classification>`
- **Export:** `tracker.ts export --format json --out backup.json`

## Conversation pattern

When the user says:
- "Mark <identifier> as a hard no" → resolve → `crm.setLeadStatus(id, 'UNQUALIFIED')` (or equivalent per CRM) + `tracker.ts reply <id> <channel> NEGATIVE_HARD`
- "Add Marcus Lee at Acme, email marcus@acme.com, LinkedIn /in/marcus-lee" → `crm.upsertContact({...})` → `tracker.ts upsert --json '{crm_source:"hubspot", crm_id: <hs_id>, ...}'`
- "Retier <identifier> to A" → resolve → `scoring.ts update <id> 80 70`
- "What's in my stale list?" → `scoring.ts rank | grep -e NEGATIVE_SOFT -e "no reply"`

**Always:** echo the exact command(s) you'll run before running. Then show the result.

## End of run

No learnings entry required for routine admin. Add a heartbeat only if an
interesting pattern surfaced during the session (e.g. imported 50 contacts,
42 missing emails — worth flagging).

## Does NOT do

- No outreach.
- Does not mutate `learnings.md` Section C.
- Does not change rate-limiter state.
