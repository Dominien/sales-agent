/**
 * Close CRM adapter.
 *
 * MCP server (hosted): `https://mcp.close.com/mcp` — OAuth 2.0 Dynamic Client
 * Registration. Scopes: `mcp.read`, `mcp.write_safe`, `mcp.write_destructive`.
 * Tool prefix: `mcp__close__*` (harness-specific).
 *
 * Close models: leads > contacts > opportunities > activities. The sales-agent
 * `Contact` maps to a Close "lead + primary contact" pair. `Deal` maps to a
 * Close "opportunity."
 *
 * Setup walkthrough: docs/crm-adapters.md#close
 */

import type { CRMAdapter, Contact, Deal, Note, SearchQuery, TaskInput } from './crm.ts';

const NOT_RUNNABLE =
  'Close operations run via your harness MCP (mcp__close__*), not from Node. ' +
  'See CLOSE_MCP_MAPPING for the exact tool + args; skills invoke it.';

export function createCloseAdapter(): CRMAdapter {
  const stub = () => { throw new Error(NOT_RUNNABLE); };
  return {
    name: 'close',
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

export const CLOSE_MCP_MAPPING = {
  searchContacts: {
    tool: 'mcp__close__search_leads',
    argsFrom(q: SearchQuery) {
      // Close's search is query-string based. Build a sensible query.
      const parts: string[] = [];
      if (q.email) parts.push(`contact.email:"${q.email}"`);
      if (q.company) parts.push(`company:"${q.company}"`);
      if (q.query) parts.push(q.query);
      return { query: parts.join(' AND ') || '*', limit: q.limit ?? 50 };
    },
  },
  getContact: {
    tool: 'mcp__close__get_lead',
    argsFrom(id: string) {
      return { lead_id: id };
    },
  },
  upsertContact: {
    /** Create as lead+contact; update existing lead if id provided. */
    tool: 'mcp__close__upsert_lead',
    argsFrom(c: Partial<Contact>) {
      return {
        lead_id: c.id,
        name: c.company ?? `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim(),
        status_label: c.lead_status,
        contacts: [{
          name: `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim(),
          title: c.job_title,
          emails: c.email ? [{email: c.email, type: 'office'}] : [],
          urls: c.linkedin_url ? [{url: c.linkedin_url, type: 'linkedin'}] : [],
        }],
      };
    },
  },
  setLeadStatus: {
    tool: 'mcp__close__update_lead',
    argsFrom(id: string, status: string) {
      return { lead_id: id, status_label: status };
    },
  },
  listNotes: {
    tool: 'mcp__close__list_activities',
    argsFrom(leadId: string) {
      return { lead_id: leadId, activity_type: 'note' };
    },
  },
  addNote: {
    tool: 'mcp__close__create_activity',
    argsFrom(leadId: string, body: string) {
      return { lead_id: leadId, activity_type: 'note', note: body };
    },
  },
  listDeals: {
    tool: 'mcp__close__list_opportunities',
    argsFrom(f?: {contact_id?: string; stage?: string}) {
      return { lead_id: f?.contact_id, status_label: f?.stage };
    },
  },
  upsertDeal: {
    tool: 'mcp__close__upsert_opportunity',
    argsFrom(d: Partial<Deal>) {
      return {
        opportunity_id: d.id,
        lead_id: d.contact_id,
        note: d.name,
        value: d.amount,
        status_label: d.stage,
        date_won: d.close_date,
      };
    },
  },
  createTask: {
    tool: 'mcp__close__create_task',
    argsFrom(t: TaskInput) {
      return {
        lead_id: t.contact_id,
        text: t.title,
        date: t.due_date,
      };
    },
  },
} as const;
