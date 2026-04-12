/**
 * HubSpot CRM adapter.
 *
 * MCP server (hosted): `https://mcp.hubspot.com/anthropic` — connect via your
 * harness OAuth. In Claude Code that's usually `claude.ai HubSpot` in `claude
 * mcp list`. Tool prefix: `mcp__hubspot__*` (or harness-specific).
 *
 * This file provides:
 *   - HubSpot adapter constructor (throws on method calls — see note below)
 *   - HUBSPOT_MCP_MAPPING — canonical → HubSpot MCP tool + args
 *
 * Why the constructor throws:
 *   Actual MCP tool invocation happens in your harness at skill time. Skills
 *   invoke `mcp__hubspot__search_crm_objects(...)` directly per the mapping
 *   below, then upsert the response into the local tracker via
 *   `db.upsertContact({crm_source: 'hubspot', crm_id: hs_id, ...})`.
 *
 * Ported from `~/hubspot-email-agent/src/tools/hubspot.ts` (17 commands) —
 * the Node CLI path lives there if you need HubSpot calls from scripts. For
 * v1 of sales-agent we don't duplicate the CLI; the MCP path is primary.
 */

import type { CRMAdapter, Contact, Deal, Note, SearchQuery, TaskInput } from './crm.ts';

const NOT_RUNNABLE =
  'HubSpot operations run via your harness MCP (mcp__hubspot__*), not from Node. ' +
  'See HUBSPOT_MCP_MAPPING in this file for the exact tool + args; skills invoke it.';

export function createHubspotAdapter(): CRMAdapter {
  const stub = () => { throw new Error(NOT_RUNNABLE); };
  return {
    name: 'hubspot',
    async searchContacts(_q: SearchQuery): Promise<Contact[]> { stub(); return []; },
    async getContact(_id: string): Promise<Contact | null> { stub(); return null; },
    async upsertContact(_c: Partial<Contact>): Promise<Contact> { stub(); return {} as Contact; },
    async setLeadStatus(_id: string, _status: string): Promise<void> { stub(); },
    async listNotes(_id: string): Promise<Note[]> { stub(); return []; },
    async addNote(_id: string, _body: string): Promise<void> { stub(); },
    async listDeals(_f): Promise<Deal[]> { stub(); return []; },
    async upsertDeal(_d): Promise<Deal> { stub(); return {} as Deal; },
    async createTask(_t: TaskInput): Promise<{id: string}> { stub(); return {id: ''}; },
  };
}

/**
 * Canonical CRMAdapter operation → HubSpot MCP tool + argument mapping.
 * Skills consume this when composing MCP calls.
 *
 * Reference: HubSpot MCP server tools are stable as of April 2026.
 */
export const HUBSPOT_MCP_MAPPING = {
  searchContacts: {
    tool: 'mcp__hubspot__search_crm_objects',
    argsFrom(q: SearchQuery) {
      const filters: Array<{propertyName: string; operator: string; value: string}> = [];
      if (q.email) filters.push({propertyName: 'email', operator: 'EQ', value: q.email});
      if (q.company) filters.push({propertyName: 'company', operator: 'CONTAINS_TOKEN', value: q.company});
      return {
        objectType: 'contacts',
        filterGroups: filters.length ? [{filters}] : [],
        query: q.query,
        limit: q.limit ?? 50,
        properties: [
          'email', 'firstname', 'lastname', 'company', 'jobtitle',
          'hs_lead_status', 'hubspot_owner_id', 'city', 'state', 'country',
          'linkedin_url', // custom property — may need to be created in your HubSpot first
        ],
      };
    },
  },
  getContact: {
    tool: 'mcp__hubspot__get_crm_objects',
    argsFrom(id: string) {
      return { objectType: 'contacts', objectId: id, properties: ['*'] };
    },
  },
  upsertContact: {
    tool: 'mcp__hubspot__manage_crm_objects',
    argsFrom(c: Partial<Contact>) {
      return {
        objectType: 'contacts',
        operation: c.id ? 'UPDATE' : 'CREATE',
        objectId: c.id,
        properties: {
          email: c.email,
          firstname: c.firstname,
          lastname: c.lastname,
          company: c.company,
          jobtitle: c.job_title,
          hs_lead_status: c.lead_status,
          linkedin_url: c.linkedin_url,
        },
      };
    },
  },
  setLeadStatus: {
    tool: 'mcp__hubspot__manage_crm_objects',
    argsFrom(id: string, status: string) {
      return {
        objectType: 'contacts',
        operation: 'UPDATE',
        objectId: id,
        properties: { hs_lead_status: status },
      };
    },
  },
  listNotes: {
    tool: 'mcp__hubspot__search_crm_objects',
    argsFrom(contactId: string) {
      return {
        objectType: 'notes',
        filterGroups: [{filters: [{propertyName: 'associations.contact', operator: 'EQ', value: contactId}]}],
        properties: ['hs_note_body', 'hs_createdate'],
        limit: 50,
      };
    },
  },
  addNote: {
    tool: 'mcp__hubspot__manage_crm_objects',
    argsFrom(contactId: string, body: string) {
      return {
        objectType: 'notes',
        operation: 'CREATE',
        properties: { hs_note_body: body },
        associations: [{toObjectType: 'contacts', toObjectId: contactId, associationType: 202}],
      };
    },
  },
  listDeals: {
    tool: 'mcp__hubspot__search_crm_objects',
    argsFrom(filter?: {contact_id?: string; stage?: string}) {
      const f: Array<{propertyName: string; operator: string; value: string}> = [];
      if (filter?.contact_id) f.push({propertyName: 'associations.contact', operator: 'EQ', value: filter.contact_id});
      if (filter?.stage) f.push({propertyName: 'dealstage', operator: 'EQ', value: filter.stage});
      return {
        objectType: 'deals',
        filterGroups: f.length ? [{filters: f}] : [],
        properties: ['dealname', 'amount', 'dealstage', 'closedate'],
        limit: 100,
      };
    },
  },
  upsertDeal: {
    tool: 'mcp__hubspot__manage_crm_objects',
    argsFrom(d: Partial<Deal>) {
      return {
        objectType: 'deals',
        operation: d.id ? 'UPDATE' : 'CREATE',
        objectId: d.id,
        properties: {
          dealname: d.name,
          amount: d.amount,
          dealstage: d.stage,
          closedate: d.close_date,
        },
      };
    },
  },
  createTask: {
    tool: 'mcp__hubspot__manage_crm_objects',
    argsFrom(t: TaskInput) {
      return {
        objectType: 'tasks',
        operation: 'CREATE',
        properties: {
          hs_task_subject: t.title,
          hs_task_body: t.note ?? '',
          hs_timestamp: t.due_date ?? new Date().toISOString(),
        },
        associations: t.contact_id
          ? [{toObjectType: 'contacts', toObjectId: t.contact_id, associationType: 204}]
          : [],
      };
    },
  },
} as const;
