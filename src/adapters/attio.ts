/**
 * Attio CRM adapter.
 *
 * MCP server (hosted): per `docs.attio.com/mcp`. OAuth. Tool prefix:
 * `mcp__attio__*`.
 *
 * Attio models everything as "records" in "lists" with a flexible schema. For
 * sales-agent canonical types:
 *   Contact → Attio "People" record
 *   Deal    → Attio "Deals" record (if the workspace has a Deals list)
 *   Note    → Attio "Note" entity attached to a record
 *
 * Setup walkthrough: docs/crm-adapters.md#attio
 */

import type { CRMAdapter, Contact, Deal, Note, SearchQuery, TaskInput } from './crm.ts';

const NOT_RUNNABLE =
  'Attio operations run via your harness MCP (mcp__attio__*), not from Node. ' +
  'See ATTIO_MCP_MAPPING for the exact tool + args; skills invoke it.';

export function createAttioAdapter(): CRMAdapter {
  const stub = () => { throw new Error(NOT_RUNNABLE); };
  return {
    name: 'attio',
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

export const ATTIO_MCP_MAPPING = {
  searchContacts: {
    tool: 'mcp__attio__search_records',
    argsFrom(q: SearchQuery) {
      const filters: Record<string, unknown> = {};
      if (q.email) filters.email_addresses = { contains: q.email };
      if (q.company) filters.company = { contains: q.company };
      return {
        object: 'people',
        filter: Object.keys(filters).length ? filters : undefined,
        query: q.query,
        limit: q.limit ?? 50,
      };
    },
  },
  getContact: {
    tool: 'mcp__attio__get_record',
    argsFrom(id: string) {
      return { object: 'people', record_id: id };
    },
  },
  upsertContact: {
    tool: 'mcp__attio__upsert_record',
    argsFrom(c: Partial<Contact>) {
      return {
        object: 'people',
        record_id: c.id,
        values: {
          email_addresses: c.email ? [c.email] : [],
          name: [{first_name: c.firstname, last_name: c.lastname}].filter(() => c.firstname || c.lastname),
          job_title: c.job_title,
          linkedin: c.linkedin_url,
          company: c.company,
        },
      };
    },
  },
  setLeadStatus: {
    // Attio lead status is typically a custom select field. Workspace owners set the attribute slug.
    tool: 'mcp__attio__update_record',
    argsFrom(id: string, status: string) {
      return { object: 'people', record_id: id, values: { lead_status: status } };
    },
  },
  listNotes: {
    tool: 'mcp__attio__list_notes',
    argsFrom(recordId: string) {
      return { parent_object: 'people', parent_record_id: recordId };
    },
  },
  addNote: {
    tool: 'mcp__attio__create_note',
    argsFrom(recordId: string, body: string) {
      return { parent_object: 'people', parent_record_id: recordId, format: 'plaintext', content: body };
    },
  },
  listDeals: {
    tool: 'mcp__attio__search_records',
    argsFrom(f?: {contact_id?: string; stage?: string}) {
      const filter: Record<string, unknown> = {};
      if (f?.contact_id) filter.associated_people = { contains: f.contact_id };
      if (f?.stage) filter.stage = { eq: f.stage };
      return { object: 'deals', filter, limit: 100 };
    },
  },
  upsertDeal: {
    tool: 'mcp__attio__upsert_record',
    argsFrom(d: Partial<Deal>) {
      return {
        object: 'deals',
        record_id: d.id,
        values: {
          name: d.name,
          value: d.amount,
          stage: d.stage,
          close_date: d.close_date,
          associated_people: d.contact_id ? [d.contact_id] : [],
        },
      };
    },
  },
  createTask: {
    tool: 'mcp__attio__create_task',
    argsFrom(t: TaskInput) {
      return {
        linked_records: t.contact_id ? [{object: 'people', record_id: t.contact_id}] : [],
        content: t.title + (t.note ? `\n\n${t.note}` : ''),
        due_at: t.due_date,
      };
    },
  },
} as const;
