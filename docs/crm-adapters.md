# CRM Adapters

One file per CRM in `src/adapters/`. Each implements the `CRMAdapter`
interface (`src/adapters/crm.ts`) and documents its `_MCP_MAPPING`.

## Shipped in v1

### SQLite (no external CRM)

**File:** `src/adapters/sqlite.ts`
**When to use:** no CRM yet; want to start fresh; agent-only workflow.
**Setup:** none. `tracker.db` is created on first tracker command.
**Capabilities:** all interface methods. Notes, tasks, deals stored in their
own SQLite tables.
**Limitations:** no multi-user, no automations, no webhooks — it's a local log.

### HubSpot

**File:** `src/adapters/hubspot.ts`
**MCP:** hosted at `https://mcp.hubspot.com/anthropic`. Harness-managed OAuth.
**Tools:** `mcp__hubspot__search_crm_objects`, `get_crm_objects`,
`manage_crm_objects`, `get_properties`, `search_owners`, `submit_feedback`.

**Setup (Claude Code):**
1. In Claude Code Settings → MCP → connect `claude.ai HubSpot`.
2. Authorize the OAuth flow with your HubSpot account.
3. Verify: `claude mcp list | grep -i hubspot` shows `✓ Connected`.

**Required custom property:**
- Settings → Properties → Contact properties → Create `linkedin_url` (single-line text).

### Close

**File:** `src/adapters/close.ts`
**MCP:** hosted at `https://mcp.close.com/mcp`. OAuth 2.0 Dynamic Client Registration.
**Scopes:** `mcp.read`, `mcp.write_safe` (standard); `mcp.write_destructive` if you want the agent to archive / delete.

**Setup:** follow the MCP setup flow in your harness. Close's OAuth app will
prompt for scopes during connection.

**Mapping note:** Close's data model leads with `Lead` (≈ company + pipeline
presence) and attaches `Contact` (people) + `Opportunity` (deals). The adapter
treats a sales-agent `Contact` as a `Lead + primary Contact` pair — which means
a "new contact" creates a new Lead in Close with one contact attached.

### Attio

**File:** `src/adapters/attio.ts`
**MCP:** hosted per `docs.attio.com/mcp`. OAuth.

**Setup:** follow the MCP setup in your harness. Attio's workspace schema is
flexible — the adapter assumes the default `People` + `Companies` + `Deals`
lists. If you've renamed them, edit the `ATTIO_MCP_MAPPING` args.

**Note:** Attio's `lead_status` is a custom attribute. The adapter uses the
slug `lead_status` — if your workspace uses a different slug, edit the
`setLeadStatus` mapping.

### Salesforce

**File:** `src/adapters/salesforce.ts`
**MCP:** self-hosted `salesforcecli/mcp`. Org-level OAuth via sfdx CLI.

**Setup:**
```bash
npm install -g @salesforce/cli @salesforce/mcp
sf org login web --alias default
claude mcp add salesforce --scope user -- sf-mcp   # adjust for your harness
```

**Required custom field on Contact:**
- Setup → Object Manager → Contact → Fields & Relationships → New
- Type: URL. Label: LinkedIn URL. API Name: `LinkedIn_URL__c`

**Leads vs Contacts:** Salesforce distinguishes pre-qualified Leads from
post-qualified Contacts. The adapter uses `Contact` as its primary SObject and
stores the distinction in `custom.sobject_type` if needed. Skills that must
differentiate can read that — most don't need to.

**SOQL note:** the adapter uses SOQL queries via `soql_query`. Read-only
operations may be cached by Salesforce — if you see stale data, add a
`LIMIT` clause or force a refresh via `mcp__salesforce__refresh_cache`.

---

## Adding your own CRM

1. Create `src/adapters/<my-crm>.ts`:

   ```ts
   import type { CRMAdapter, Contact, Note, SearchQuery } from './crm.ts';

   export function createMyCrmAdapter(): CRMAdapter {
     return {
       name: 'my-crm' as any,        // add to CRMName union below
       async searchContacts(q: SearchQuery): Promise<Contact[]> { /* ... */ return []; },
       async getContact(id) { /* ... */ return null; },
       async upsertContact(c) { /* ... */ return {} as Contact; },
       async setLeadStatus(id, status) { /* ... */ },
       async listNotes(id) { /* ... */ return []; },
       async addNote(id, body) { /* ... */ },
     };
   }

   export const MY_CRM_MCP_MAPPING = { /* tool name + argsFrom per operation */ } as const;
   ```

2. In `src/adapters/crm.ts`:
   - Add `'my-crm'` to the `CRMName` union.
   - Add a `case 'my-crm':` to `loadAdapter()`.

3. Add a section to this doc under "Shipped in v1" (or "Community" if not official).

4. Add credential placeholders to `.env.example`.

5. Add a wizard prompt line to `src/init.ts` (the CRM chooser list).

That's ~150 LOC for most CRMs with MCP support.

## Community CRMs (documented, not shipped in v1)

| CRM | MCP | Adapter status | Notes |
|---|---|---|---|
| Pipedrive | community (`iamsamuelfraga/mcp-pipedrive` — most complete) | BYO | 100+ tools, active |
| Folk | community (`NimbleBrainInc/mcp-folk`) | BYO | Popular with creators/agencies |
| Copper | bridge-only (Pipedream, Zapier MCP) | BYO | Low priority — no first-party MCP |

To add any of these: write ~200 LOC per the "Adding your own CRM" pattern
above. Most community MCPs have the same `searchContacts` / `upsertContact` /
`listNotes` shape; wiring is straightforward.

## First-party MCP CRMs we haven't adapted yet (v1.1)

All have the same OAuth pattern as HubSpot/Close/Attio. Adding them is
straightforward:

- Notion (`makenotion/notion-mcp-server`)
- Airtable (official hosted)
- Monday.com (`mondaycom/mcp`)
- Zoho CRM (official)
