# CRM adapters

One folder, one file per CRM. Every adapter implements the `CRMAdapter`
interface defined in `crm.ts`.

## Shipped in v1

| Adapter | File | MCP prefix | Auth | Notes |
|---|---|---|---|---|
| `sqlite` | `sqlite.ts` | n/a | none | Default. Tracker.db IS the CRM. |
| `hubspot` | `hubspot.ts` | `mcp__hubspot__*` | harness-managed OAuth | Hosted at `mcp.hubspot.com/anthropic` |
| `close` | `close.ts` | `mcp__close__*` | OAuth 2.0 DCR | Hosted at `mcp.close.com/mcp` |
| `attio` | `attio.ts` | `mcp__attio__*` | OAuth | Hosted per `docs.attio.com/mcp` |
| `salesforce` | `salesforce.ts` | `mcp__salesforce__*` | sfdx CLI auth | Self-hosted `salesforcecli/mcp` |

## How adapters work

Skills never call MCP tools directly. They do:

```ts
import { loadAdapter } from '../adapters/crm.ts';
import { loadConfig } from '../config.ts';

const cfg = loadConfig();
const crm = await loadAdapter(cfg.crm);
const contacts = await crm.searchContacts({ email: 'marcus@acme.com' });
```

The adapter translates into whichever MCP tool call is appropriate for its
backend, normalizes the response into a `Contact`, and returns it. The skill
then upserts into the local tracker (`db.upsertContact`) so both the CRM and
the tracker converge.

## Adding your own CRM

1. Create `src/adapters/<my-crm>.ts` exporting `createMyCrmAdapter(): CRMAdapter`.
2. Add `'my-crm'` to the `CRMName` union in `crm.ts`.
3. Add a case in `loadAdapter()` in `crm.ts`.
4. Document setup under `docs/crm-adapters.md`.
5. Add credential placeholders to `.env.example`.

The interface surface is intentionally small — most adapters are ~150–250 LOC.
If your CRM has an MCP server, most methods are one-liners translating between
the canonical shape and the MCP tool's arguments.

## NotImplemented methods

Optional methods (`listDeals`, `createTask`, etc.) can throw `NotImplemented`
if your CRM doesn't support the concept. Skills that rely on these methods
(`pipeline-analysis` uses deals) will fall back gracefully or skip the relevant
section of their report.
