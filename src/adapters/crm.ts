/**
 * CRMAdapter — the single contract every CRM backend implements.
 *
 * Skills import this interface, not any specific adapter. At runtime the
 * selected adapter (sqlite / hubspot / close / attio / salesforce) is
 * instantiated based on `agent.config.json` → crm.
 *
 * All methods are async so harness-MCP calls (which are async) fit naturally.
 * SQLite adapter wraps synchronous db.ts calls in Promise.resolve().
 *
 * Design notes:
 *   - `contact.id` is adapter-local (uuid for SQLite, hs_id for HubSpot, etc.).
 *   - Skills ALSO track by tracker.contact_id (the UUID in our SQLite tracker).
 *     The contract is: after a CRM operation, skills upsert the result into
 *     the tracker via db.upsertContact({crm_source, crm_id, ...}).
 *   - Optional methods (listDeals, createTask) return an empty list or throw a
 *     NotImplemented error on adapters that don't support the concept.
 */

export type CRMName = 'sqlite' | 'hubspot' | 'close' | 'attio' | 'salesforce';

export interface Contact {
  id: string;
  email?: string;
  linkedin_url?: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  job_title?: string;
  headline?: string;
  location?: string;
  lead_status?: string;
  owner_id?: string;
  owner_email?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
}

export interface Note {
  id?: string;
  body: string;
  created_at: string;
  author?: string;
}

export interface Deal {
  id: string;
  name: string;
  amount?: string;
  stage?: string;
  close_date?: string;
  contact_id?: string;
  company?: string;
  owner_id?: string;
  custom?: Record<string, unknown>;
}

export interface TaskInput {
  contact_id?: string;
  deal_id?: string;
  title: string;
  due_date?: string;
  note?: string;
}

export interface SearchQuery {
  email?: string;
  linkedin_url?: string;
  query?: string;           // free-text fallback
  company?: string;
  limit?: number;
}

export class NotImplemented extends Error {
  constructor(adapter: string, method: string) {
    super(`${adapter} adapter does not implement ${method}()`);
    this.name = 'NotImplemented';
  }
}

export interface CRMAdapter {
  readonly name: CRMName;

  searchContacts(q: SearchQuery): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | null>;
  upsertContact(c: Partial<Contact>): Promise<Contact>;
  setLeadStatus(id: string, status: string): Promise<void>;

  listNotes(contactId: string): Promise<Note[]>;
  addNote(contactId: string, body: string): Promise<void>;

  // Optional capabilities. Adapters that don't support them throw NotImplemented.
  listDeals?(filter?: { contact_id?: string; stage?: string }): Promise<Deal[]>;
  getDeal?(id: string): Promise<Deal | null>;
  upsertDeal?(d: Partial<Deal>): Promise<Deal>;
  createTask?(t: TaskInput): Promise<{ id: string }>;
  listTasks?(filter?: { contact_id?: string; status?: string }): Promise<Array<{
    id: string;
    title: string;
    due_date?: string;
    status: string;
    contact_id?: string;
    deal_id?: string;
  }>>;
}

// Adapter registry — populated by each adapter module on import.
const registry = new Map<CRMName, () => Promise<CRMAdapter>>();

export function registerAdapter(name: CRMName, factory: () => Promise<CRMAdapter>): void {
  registry.set(name, factory);
}

export async function loadAdapter(name: CRMName): Promise<CRMAdapter> {
  // Lazy-import so we don't load e.g. Salesforce's deps when using SQLite.
  switch (name) {
    case 'sqlite': {
      const m = await import('./sqlite.ts');
      return m.createSqliteAdapter();
    }
    case 'hubspot': {
      const m = await import('./hubspot.ts');
      return m.createHubspotAdapter();
    }
    case 'close': {
      const m = await import('./close.ts');
      return m.createCloseAdapter();
    }
    case 'attio': {
      const m = await import('./attio.ts');
      return m.createAttioAdapter();
    }
    case 'salesforce': {
      const m = await import('./salesforce.ts');
      return m.createSalesforceAdapter();
    }
  }
}
