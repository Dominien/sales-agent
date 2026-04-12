/**
 * SQLite CRMAdapter — the "no external CRM" mode. tracker.db IS the CRM.
 *
 * All operations are against the local SQLite tables defined in src/db.ts:
 *   - tracker  (contacts)
 *   - notes
 *   - tasks
 *   - deals
 *
 * Advantages:
 *   - Zero setup. User starts fresh, no OAuth, no API key.
 *   - Works offline.
 *   - Same schema whether or not an external CRM is configured.
 *
 * Limitations vs external CRMs:
 *   - No multi-user / team views.
 *   - No automations, pipelines, dashboards beyond what skills produce.
 *   - No webhooks. Replies arrive via inbox-classifier, not push.
 */

import {
  upsertContact as dbUpsertContact,
  findContact,
  allRows,
  addNote as dbAddNote,
  listNotes as dbListNotes,
  createTask as dbCreateTask,
  listOpenTasks,
  upsertDeal as dbUpsertDeal,
  listDeals as dbListDeals,
  updateLeadStatus,
  type TrackerRow,
} from '../db.ts';
import type {
  CRMAdapter,
  Contact,
  Deal,
  Note,
  SearchQuery,
  TaskInput,
} from './crm.ts';

function rowToContact(row: TrackerRow): Contact {
  return {
    id: row.contact_id,
    email: row.email || undefined,
    linkedin_url: row.linkedin_url || undefined,
    firstname: row.firstname || undefined,
    lastname: row.lastname || undefined,
    company: row.company || undefined,
    job_title: row.job_title || undefined,
    headline: row.headline || undefined,
    location: row.location || undefined,
    lead_status: row.lead_status || undefined,
  };
}

export function createSqliteAdapter(): CRMAdapter {
  return {
    name: 'sqlite',

    async searchContacts(q: SearchQuery): Promise<Contact[]> {
      if (q.email) {
        const row = findContact({ email: q.email });
        return row ? [rowToContact(row)] : [];
      }
      if (q.linkedin_url) {
        const row = findContact({ linkedin_url: q.linkedin_url });
        return row ? [rowToContact(row)] : [];
      }
      // Free-text fallback: filter in memory. Small DB size expected for sqlite mode.
      const needle = (q.query || q.company || '').trim().toLowerCase();
      if (!needle) return allRows().slice(0, q.limit ?? 50).map(rowToContact);
      const rows = allRows().filter(
        (r) =>
          r.firstname.toLowerCase().includes(needle) ||
          r.lastname.toLowerCase().includes(needle) ||
          r.company.toLowerCase().includes(needle) ||
          r.email.toLowerCase().includes(needle) ||
          r.linkedin_url.toLowerCase().includes(needle) ||
          r.headline.toLowerCase().includes(needle),
      );
      return rows.slice(0, q.limit ?? 50).map(rowToContact);
    },

    async getContact(id: string): Promise<Contact | null> {
      const row = findContact({ contact_id: id });
      return row ? rowToContact(row) : null;
    },

    async upsertContact(c: Partial<Contact>): Promise<Contact> {
      const row = dbUpsertContact({
        contact_id: c.id,
        email: c.email,
        linkedin_url: c.linkedin_url,
        firstname: c.firstname,
        lastname: c.lastname,
        company: c.company,
        job_title: c.job_title,
        headline: c.headline,
        location: c.location,
        lead_status: c.lead_status,
        crm_source: 'sqlite',
      });
      return rowToContact(row);
    },

    async setLeadStatus(id: string, status: string): Promise<void> {
      if (!updateLeadStatus(id, status)) {
        throw new Error(`No contact with id ${id}`);
      }
    },

    async listNotes(contactId: string): Promise<Note[]> {
      const notes = dbListNotes(contactId);
      return notes.map((n) => ({
        id: n.id,
        body: n.body,
        created_at: n.created_at,
      }));
    },

    async addNote(contactId: string, body: string): Promise<void> {
      if (!findContact({ contact_id: contactId })) {
        throw new Error(`No contact with id ${contactId}`);
      }
      dbAddNote(contactId, body, 'sqlite');
    },

    async listDeals(filter?: { contact_id?: string; stage?: string }): Promise<Deal[]> {
      const rows = dbListDeals({ contactId: filter?.contact_id, stage: filter?.stage });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        amount: r.amount,
        stage: r.stage,
        close_date: r.close_date ?? undefined,
        contact_id: r.contact_id ?? undefined,
        company: r.company,
      }));
    },

    async upsertDeal(d: Partial<Deal>): Promise<Deal> {
      if (!d.name) throw new Error('deal.name is required');
      const row = dbUpsertDeal({
        id: d.id,
        contactId: d.contact_id,
        company: d.company,
        name: d.name,
        amount: d.amount,
        stage: d.stage,
        closeDate: d.close_date,
      });
      return {
        id: row.id,
        name: row.name,
        amount: row.amount,
        stage: row.stage,
        close_date: row.close_date ?? undefined,
        contact_id: row.contact_id ?? undefined,
        company: row.company,
      };
    },

    async createTask(t: TaskInput): Promise<{ id: string }> {
      const id = dbCreateTask({
        contactId: t.contact_id,
        dealId: t.deal_id,
        title: t.title,
        dueDate: t.due_date,
        note: t.note,
      });
      return { id };
    },

    async listTasks(filter?: { contact_id?: string; status?: string }) {
      const all = listOpenTasks();
      const f = all.filter(
        (t) =>
          (!filter?.contact_id || t.contact_id === filter.contact_id) &&
          (!filter?.status || t.status === filter.status),
      );
      return f.map((t) => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date ?? undefined,
        status: t.status,
        contact_id: t.contact_id ?? undefined,
        deal_id: t.deal_id ?? undefined,
      }));
    },
  };
}
