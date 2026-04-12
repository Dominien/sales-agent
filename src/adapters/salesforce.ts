/**
 * Salesforce CRM adapter.
 *
 * MCP server: `salesforcecli/mcp` — self-hosted (not a hosted OAuth endpoint).
 * Install: `npm install -g @salesforce/cli && npm install -g @salesforce/mcp`
 * then authorize: `sf org login web --alias default`. Tool prefix:
 * `mcp__salesforce__*`.
 *
 * Salesforce object model:
 *   Contact → Salesforce `Contact` SObject (or `Lead` for pre-qualified)
 *   Deal    → Salesforce `Opportunity` SObject
 *   Note    → `Task` with Type='Note' OR `FeedItem` (feed post) — we use the former
 *   Task    → Salesforce `Task` SObject
 *
 * Salesforce distinguishes Leads (pre-qualified) and Contacts (post-qualified).
 * This adapter treats them uniformly as "contacts" and stores the SObject type
 * in `custom.sobject_type`. Skills that need to differentiate can read that.
 *
 * Setup walkthrough: docs/crm-adapters.md#salesforce
 */

import type { CRMAdapter, Contact, Deal, Note, SearchQuery, TaskInput } from './crm.ts';

const NOT_RUNNABLE =
  'Salesforce operations run via your harness MCP (mcp__salesforce__*), not from Node. ' +
  'See SALESFORCE_MCP_MAPPING for the exact tool + args; skills invoke it.';

export function createSalesforceAdapter(): CRMAdapter {
  const stub = () => { throw new Error(NOT_RUNNABLE); };
  return {
    name: 'salesforce',
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
 * Salesforce MCP mapping uses SOQL (the query language) for reads and
 * `soql_query` / `sobject_*` tools for writes. The tool names are from
 * `salesforcecli/mcp` as of April 2026; verify with `mcp list-tools` if
 * Salesforce updates the server.
 */
export const SALESFORCE_MCP_MAPPING = {
  searchContacts: {
    tool: 'mcp__salesforce__soql_query',
    argsFrom(q: SearchQuery) {
      const where: string[] = [];
      if (q.email) where.push(`Email = '${q.email.replace(/'/g, "''")}'`);
      if (q.company) where.push(`Account.Name LIKE '%${q.company.replace(/'/g, "''")}%'`);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return {
        query: `SELECT Id, Email, FirstName, LastName, Title, Account.Name, LeadSource, MailingCity, MailingCountry
                FROM Contact ${clause} LIMIT ${q.limit ?? 50}`,
      };
    },
  },
  getContact: {
    tool: 'mcp__salesforce__sobject_describe',
    argsFrom(id: string) {
      return { sobject: 'Contact', record_id: id };
    },
  },
  upsertContact: {
    tool: 'mcp__salesforce__sobject_upsert',
    argsFrom(c: Partial<Contact>) {
      return {
        sobject: 'Contact',
        record_id: c.id,
        fields: {
          Email: c.email,
          FirstName: c.firstname,
          LastName: c.lastname,
          Title: c.job_title,
          LeadSource: c.lead_status,
          LinkedIn_URL__c: c.linkedin_url,   // custom field — must exist in your org
        },
      };
    },
  },
  setLeadStatus: {
    tool: 'mcp__salesforce__sobject_update',
    argsFrom(id: string, status: string) {
      return { sobject: 'Contact', record_id: id, fields: { LeadSource: status } };
    },
  },
  listNotes: {
    tool: 'mcp__salesforce__soql_query',
    argsFrom(contactId: string) {
      return {
        query: `SELECT Id, Subject, Description, CreatedDate FROM Task
                WHERE WhoId = '${contactId}' AND Type = 'Note' ORDER BY CreatedDate DESC LIMIT 50`,
      };
    },
  },
  addNote: {
    tool: 'mcp__salesforce__sobject_create',
    argsFrom(contactId: string, body: string) {
      return {
        sobject: 'Task',
        fields: { WhoId: contactId, Subject: 'Note', Description: body, Type: 'Note', Status: 'Completed' },
      };
    },
  },
  listDeals: {
    tool: 'mcp__salesforce__soql_query',
    argsFrom(f?: {contact_id?: string; stage?: string}) {
      const where: string[] = [];
      if (f?.contact_id) where.push(`(SELECT Id FROM OpportunityContactRoles WHERE ContactId = '${f.contact_id}') IN ...`);
      if (f?.stage) where.push(`StageName = '${f.stage.replace(/'/g, "''")}'`);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return {
        query: `SELECT Id, Name, Amount, StageName, CloseDate, AccountId
                FROM Opportunity ${clause} ORDER BY CloseDate DESC LIMIT 100`,
      };
    },
  },
  upsertDeal: {
    tool: 'mcp__salesforce__sobject_upsert',
    argsFrom(d: Partial<Deal>) {
      return {
        sobject: 'Opportunity',
        record_id: d.id,
        fields: {
          Name: d.name,
          Amount: d.amount,
          StageName: d.stage,
          CloseDate: d.close_date,
        },
      };
    },
  },
  createTask: {
    tool: 'mcp__salesforce__sobject_create',
    argsFrom(t: TaskInput) {
      return {
        sobject: 'Task',
        fields: {
          Subject: t.title,
          Description: t.note ?? '',
          ActivityDate: t.due_date?.slice(0, 10),
          WhoId: t.contact_id,
          Status: 'Not Started',
        },
      };
    },
  },
} as const;
