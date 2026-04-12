/**
 * Unified SQLite data layer for sales-agent.
 *
 * Tables:
 *   - tracker      : canonical contact + per-channel state + scoring. One row per contact.
 *                    PK `contact_id` (UUID). Both `email` and `linkedin_url` are
 *                    unique-when-non-empty secondary keys. External CRM linkage
 *                    lives in `crm_source` + `crm_id`.
 *   - notes        : append-only activity log (used by SQLite-as-CRM adapter).
 *   - tasks        : open tasks (used by SQLite-as-CRM adapter).
 *   - deals        : simple deal pipeline (used by SQLite-as-CRM adapter).
 *   - rate_state   : per-action daily/weekly counters for rate-limiter.ts.
 *
 * Design notes:
 *   - WAL journal mode for non-blocking reads during writes.
 *   - Schema applied idempotently; later migrations via PRAGMA table_info.
 *   - Prepared statements reused at module scope.
 *   - Every external lookup normalizes identifiers (email→lowercase,
 *     linkedin_url→`https://www.linkedin.com/in/<slug>`).
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../tracker.db');

export const TRACKER_COLUMNS = [
  'contact_id',
  'crm_source',
  'crm_id',
  'email',
  'linkedin_url',
  'firstname',
  'lastname',
  'company',
  'job_title',
  'headline',
  'location',
  'lead_status',
  'notes_summary',
  'email_last_draft_id',
  'email_last_drafted_at',
  'linkedin_connection_status',
  'linkedin_connection_note',
  'linkedin_connection_sent_at',
  'linkedin_connection_accepted_at',
  'linkedin_last_message_at',
  'linkedin_last_message_snippet',
  'reply_channel',
  'reply_received_at',
  'reply_classification',
  'reply_body_snippet',
  'fit_score',
  'engagement_score',
  'priority_tier',
  'status',
] as const;

export type TrackerColumn = (typeof TRACKER_COLUMNS)[number];
export type TrackerRow = Record<TrackerColumn, string>;

const NUM_COLS = TRACKER_COLUMNS.length;
const COLUMN_LIST = TRACKER_COLUMNS.join(', ');
const PLACEHOLDERS = TRACKER_COLUMNS.map(() => '?').join(', ');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tracker (
    contact_id                      TEXT PRIMARY KEY,
    crm_source                      TEXT NOT NULL DEFAULT '',
    crm_id                          TEXT NOT NULL DEFAULT '',
    email                           TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    linkedin_url                    TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    firstname                       TEXT NOT NULL DEFAULT '',
    lastname                        TEXT NOT NULL DEFAULT '',
    company                         TEXT NOT NULL DEFAULT '',
    job_title                       TEXT NOT NULL DEFAULT '',
    headline                        TEXT NOT NULL DEFAULT '',
    location                        TEXT NOT NULL DEFAULT '',
    lead_status                     TEXT NOT NULL DEFAULT '',
    notes_summary                   TEXT NOT NULL DEFAULT '',
    email_last_draft_id             TEXT NOT NULL DEFAULT '',
    email_last_drafted_at           TEXT NOT NULL DEFAULT '',
    linkedin_connection_status      TEXT NOT NULL DEFAULT '',
    linkedin_connection_note        TEXT NOT NULL DEFAULT '',
    linkedin_connection_sent_at     TEXT NOT NULL DEFAULT '',
    linkedin_connection_accepted_at TEXT NOT NULL DEFAULT '',
    linkedin_last_message_at        TEXT NOT NULL DEFAULT '',
    linkedin_last_message_snippet   TEXT NOT NULL DEFAULT '',
    reply_channel                   TEXT NOT NULL DEFAULT '',
    reply_received_at               TEXT NOT NULL DEFAULT '',
    reply_classification            TEXT NOT NULL DEFAULT '',
    reply_body_snippet              TEXT NOT NULL DEFAULT '',
    fit_score                       TEXT NOT NULL DEFAULT '',
    engagement_score                TEXT NOT NULL DEFAULT '',
    priority_tier                   TEXT NOT NULL DEFAULT '',
    status                          TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_email_uniq        ON tracker(email)        WHERE email != '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_linkedin_url_uniq ON tracker(linkedin_url) WHERE linkedin_url != '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_crm_uniq          ON tracker(crm_source, crm_id) WHERE crm_id != '';
  CREATE INDEX IF NOT EXISTS idx_tracker_email_last_drafted_at  ON tracker(email_last_drafted_at);
  CREATE INDEX IF NOT EXISTS idx_tracker_linkedin_last_message  ON tracker(linkedin_last_message_at);
  CREATE INDEX IF NOT EXISTS idx_tracker_reply_received_at      ON tracker(reply_received_at);
  CREATE INDEX IF NOT EXISTS idx_tracker_priority_tier          ON tracker(priority_tier);
  CREATE INDEX IF NOT EXISTS idx_tracker_status                 ON tracker(status);

  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    contact_id  TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'sqlite',
    FOREIGN KEY (contact_id) REFERENCES tracker(contact_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(contact_id);

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    contact_id  TEXT,
    deal_id     TEXT,
    title       TEXT NOT NULL,
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'NOT_STARTED',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);

  CREATE TABLE IF NOT EXISTS deals (
    id           TEXT PRIMARY KEY,
    contact_id   TEXT,
    company      TEXT NOT NULL DEFAULT '',
    name         TEXT NOT NULL,
    amount       TEXT NOT NULL DEFAULT '',
    stage        TEXT NOT NULL DEFAULT '',
    close_date   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
  CREATE INDEX IF NOT EXISTS idx_deals_stage   ON deals(stage);

  CREATE TABLE IF NOT EXISTS rate_state (
    action_type    TEXT NOT NULL,
    window_key     TEXT NOT NULL,
    count          INTEGER NOT NULL DEFAULT 0,
    last_action_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (action_type, window_key)
  );
`);

// ─── Identifier normalization ────────────────────────────────────────────

export function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

export function normalizeLinkedInUrl(raw: string): string {
  if (!raw) return '';
  let url = raw.trim().toLowerCase();
  url = url.replace(/\?.*$/, '').replace(/\/+$/, '');
  const m = url.match(/linkedin\.com\/(in|company)\/([^/?#]+)/);
  return m ? `https://www.linkedin.com/${m[1]}/${m[2]}` : url;
}

export function newContactId(): string {
  return randomUUID();
}

// ─── Prepared statements ─────────────────────────────────────────────────

const stmtAllRows = db.prepare(`SELECT ${COLUMN_LIST} FROM tracker ORDER BY contact_id`);
const stmtFindByEmail = db.prepare(`SELECT ${COLUMN_LIST} FROM tracker WHERE email = ? AND email != ''`);
const stmtFindByLinkedIn = db.prepare(`SELECT ${COLUMN_LIST} FROM tracker WHERE linkedin_url = ? AND linkedin_url != ''`);
const stmtFindByContactId = db.prepare(`SELECT ${COLUMN_LIST} FROM tracker WHERE contact_id = ?`);
const stmtFindByCrm = db.prepare(`SELECT ${COLUMN_LIST} FROM tracker WHERE crm_source = ? AND crm_id = ? AND crm_id != ''`);
const stmtInsertRow = db.prepare(`INSERT INTO tracker (${COLUMN_LIST}) VALUES (${PLACEHOLDERS})`);
const stmtRowsInWindow = db.prepare(
  `SELECT ${COLUMN_LIST} FROM tracker
   WHERE (email_last_drafted_at    >= ? AND email_last_drafted_at    <= ?)
      OR (linkedin_last_message_at >= ? AND linkedin_last_message_at <= ?)
      OR (linkedin_connection_sent_at >= ? AND linkedin_connection_sent_at <= ?)
   ORDER BY contact_id`,
);
const stmtRowsByPriority = db.prepare(
  `SELECT ${COLUMN_LIST} FROM tracker
   WHERE priority_tier != ''
   ORDER BY CASE priority_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END,
            CAST(fit_score AS INTEGER) DESC,
            CAST(engagement_score AS INTEGER) DESC`,
);

// ─── Upsert helper ───────────────────────────────────────────────────────

export interface UpsertInput {
  // Identifiers — at least one of email / linkedin_url / crm_id should be set.
  email?: string;
  linkedin_url?: string;
  crm_source?: string;
  crm_id?: string;
  // Everything else is optional partial update.
  firstname?: string;
  lastname?: string;
  company?: string;
  job_title?: string;
  headline?: string;
  location?: string;
  lead_status?: string;
  notes_summary?: string;
  // Channel state is normally updated by dedicated helpers, but allowed here too.
  [k: string]: string | undefined;
}

/**
 * Find existing row by (in order): contact_id → crm_source+crm_id → linkedin_url → email.
 * Returns the row, or null if no match.
 */
export function findContact(q: {
  contact_id?: string;
  crm_source?: string;
  crm_id?: string;
  email?: string;
  linkedin_url?: string;
}): TrackerRow | null {
  if (q.contact_id) {
    const r = stmtFindByContactId.get(q.contact_id) as TrackerRow | undefined;
    if (r) return r;
  }
  if (q.crm_source && q.crm_id) {
    const r = stmtFindByCrm.get(q.crm_source, q.crm_id) as TrackerRow | undefined;
    if (r) return r;
  }
  if (q.linkedin_url) {
    const r = stmtFindByLinkedIn.get(normalizeLinkedInUrl(q.linkedin_url)) as TrackerRow | undefined;
    if (r) return r;
  }
  if (q.email) {
    const r = stmtFindByEmail.get(normalizeEmail(q.email)) as TrackerRow | undefined;
    if (r) return r;
  }
  return null;
}

/**
 * Upsert a contact. If any existing row matches by identifier, updates it with provided
 * fields (leaving untouched columns alone). Otherwise inserts a new row with a fresh UUID.
 * Returns the resulting row.
 */
export function upsertContact(input: UpsertInput): TrackerRow {
  const email = input.email ? normalizeEmail(input.email) : '';
  const linkedin_url = input.linkedin_url ? normalizeLinkedInUrl(input.linkedin_url) : '';

  const existing = findContact({
    contact_id: input.contact_id as string | undefined,
    crm_source: input.crm_source,
    crm_id: input.crm_id,
    email: email || undefined,
    linkedin_url: linkedin_url || undefined,
  });

  if (existing) {
    // Build a dynamic UPDATE only for columns actually provided.
    const updates: string[] = [];
    const values: string[] = [];
    for (const col of TRACKER_COLUMNS) {
      if (col === 'contact_id') continue;
      const v = input[col as string];
      if (typeof v !== 'string') continue;
      let newVal = v;
      if (col === 'email') newVal = normalizeEmail(v);
      if (col === 'linkedin_url') newVal = normalizeLinkedInUrl(v);
      updates.push(`${col} = ?`);
      values.push(newVal);
    }
    if (updates.length === 0) return existing;
    values.push(existing.contact_id);
    db.prepare(`UPDATE tracker SET ${updates.join(', ')} WHERE contact_id = ?`).run(...values);
    return stmtFindByContactId.get(existing.contact_id) as TrackerRow;
  }

  // Insert
  const row: Record<TrackerColumn, string> = Object.fromEntries(
    TRACKER_COLUMNS.map((c) => [c, '']),
  ) as Record<TrackerColumn, string>;
  row.contact_id = newContactId();
  for (const col of TRACKER_COLUMNS) {
    const v = input[col as string];
    if (typeof v === 'string') {
      if (col === 'email') row[col] = normalizeEmail(v);
      else if (col === 'linkedin_url') row[col] = normalizeLinkedInUrl(v);
      else row[col] = v;
    }
  }
  // Overwrite identifiers with normalized copies
  if (email) row.email = email;
  if (linkedin_url) row.linkedin_url = linkedin_url;
  if (input.crm_source) row.crm_source = input.crm_source;
  if (input.crm_id) row.crm_id = input.crm_id;

  const values = TRACKER_COLUMNS.map((c) => row[c]);
  stmtInsertRow.run(...values);
  return row;
}

// ─── Read helpers ────────────────────────────────────────────────────────

export function allRows(): TrackerRow[] {
  return stmtAllRows.all() as TrackerRow[];
}

export function rowsInWindow(startIso: string, endIso: string): TrackerRow[] {
  return stmtRowsInWindow.all(startIso, endIso, startIso, endIso, startIso, endIso) as TrackerRow[];
}

export function rowsByPriority(): TrackerRow[] {
  return stmtRowsByPriority.all() as TrackerRow[];
}

// ─── Targeted updaters ───────────────────────────────────────────────────

const stmtUpdateEmailDraft = db.prepare(`
  UPDATE tracker SET email_last_draft_id = ?, email_last_drafted_at = ? WHERE contact_id = ?
`);
const stmtUpdateLinkedInConnection = db.prepare(`
  UPDATE tracker SET
    linkedin_connection_status = ?,
    linkedin_connection_note   = COALESCE(NULLIF(?, ''), linkedin_connection_note),
    linkedin_connection_sent_at = COALESCE(NULLIF(?, ''), linkedin_connection_sent_at),
    linkedin_connection_accepted_at = COALESCE(NULLIF(?, ''), linkedin_connection_accepted_at)
  WHERE contact_id = ?
`);
const stmtUpdateLinkedInMessage = db.prepare(`
  UPDATE tracker SET
    linkedin_last_message_at = ?,
    linkedin_last_message_snippet = ?
  WHERE contact_id = ?
`);
const stmtUpdateReply = db.prepare(`
  UPDATE tracker SET
    reply_channel        = ?,
    reply_received_at    = ?,
    reply_classification = ?,
    reply_body_snippet   = COALESCE(NULLIF(?, ''), reply_body_snippet)
  WHERE contact_id = ?
`);
const stmtUpdateScores = db.prepare(`
  UPDATE tracker SET fit_score = ?, engagement_score = ?, priority_tier = ? WHERE contact_id = ?
`);
const stmtUpdateStatus = db.prepare(`UPDATE tracker SET status = ? WHERE contact_id = ?`);
const stmtUpdateLeadStatus = db.prepare(`UPDATE tracker SET lead_status = ? WHERE contact_id = ?`);
const stmtUpdateNotesSummary = db.prepare(`UPDATE tracker SET notes_summary = ? WHERE contact_id = ?`);

export const updateEmailDraft = (contactId: string, draftId: string) =>
  stmtUpdateEmailDraft.run(draftId, new Date().toISOString(), contactId).changes > 0;

export const updateLinkedInConnection = (
  contactId: string,
  status: string,
  note: string = '',
  sentAt: string = '',
  acceptedAt: string = '',
) => stmtUpdateLinkedInConnection.run(status, note, sentAt, acceptedAt, contactId).changes > 0;

export const updateLinkedInMessage = (contactId: string, snippet: string) =>
  stmtUpdateLinkedInMessage.run(new Date().toISOString(), snippet, contactId).changes > 0;

export const updateReply = (
  contactId: string,
  channel: 'email' | 'linkedin',
  classification: string,
  bodySnippet: string = '',
) => stmtUpdateReply.run(channel, new Date().toISOString(), classification, bodySnippet, contactId).changes > 0;

export const updateScores = (
  contactId: string,
  fit: number,
  engagement: number,
  tier: string,
) => stmtUpdateScores.run(String(fit), String(engagement), tier, contactId).changes > 0;

export const updateStatus = (contactId: string, status: string) =>
  stmtUpdateStatus.run(status, contactId).changes > 0;

export const updateLeadStatus = (contactId: string, status: string) =>
  stmtUpdateLeadStatus.run(status, contactId).changes > 0;

export const updateNotesSummary = (contactId: string, summary: string) =>
  stmtUpdateNotesSummary.run(summary, contactId).changes > 0;

// ─── Notes / tasks / deals (consumed by SQLite-as-CRM adapter) ──────────

const stmtInsertNote = db.prepare(`
  INSERT INTO notes (id, contact_id, body, created_at, source) VALUES (?, ?, ?, ?, ?)
`);
const stmtListNotes = db.prepare(`
  SELECT id, contact_id, body, created_at, source FROM notes WHERE contact_id = ? ORDER BY created_at DESC
`);

export function addNote(contactId: string, body: string, source: string = 'sqlite'): void {
  stmtInsertNote.run(randomUUID(), contactId, body, new Date().toISOString(), source);
}

export interface NoteRow {
  id: string;
  contact_id: string;
  body: string;
  created_at: string;
  source: string;
}

export function listNotes(contactId: string): NoteRow[] {
  return stmtListNotes.all(contactId) as NoteRow[];
}

const stmtInsertTask = db.prepare(`
  INSERT INTO tasks (id, contact_id, deal_id, title, due_date, status, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtListTasks = db.prepare(`
  SELECT id, contact_id, deal_id, title, due_date, status, note, created_at, completed_at
  FROM tasks WHERE status != 'COMPLETED' ORDER BY COALESCE(due_date, created_at)
`);
const stmtCompleteTask = db.prepare(`
  UPDATE tasks SET status = 'COMPLETED', completed_at = ? WHERE id = ?
`);

export interface TaskInput {
  contactId?: string;
  dealId?: string;
  title: string;
  dueDate?: string;
  note?: string;
}

export function createTask(t: TaskInput): string {
  const id = randomUUID();
  stmtInsertTask.run(
    id,
    t.contactId ?? null,
    t.dealId ?? null,
    t.title,
    t.dueDate ?? null,
    'NOT_STARTED',
    t.note ?? '',
    new Date().toISOString(),
  );
  return id;
}

export interface TaskRow {
  id: string;
  contact_id: string | null;
  deal_id: string | null;
  title: string;
  due_date: string | null;
  status: string;
  note: string;
  created_at: string;
  completed_at: string | null;
}

export function listOpenTasks(): TaskRow[] {
  return stmtListTasks.all() as TaskRow[];
}

export function completeTask(id: string): boolean {
  return stmtCompleteTask.run(new Date().toISOString(), id).changes > 0;
}

const stmtInsertDeal = db.prepare(`
  INSERT INTO deals (id, contact_id, company, name, amount, stage, close_date, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtListDeals = db.prepare(
  `SELECT id, contact_id, company, name, amount, stage, close_date, created_at, updated_at
   FROM deals ORDER BY updated_at DESC`,
);
const stmtListDealsByContact = db.prepare(
  `SELECT id, contact_id, company, name, amount, stage, close_date, created_at, updated_at
   FROM deals WHERE contact_id = ? ORDER BY updated_at DESC`,
);
const stmtListDealsByStage = db.prepare(
  `SELECT id, contact_id, company, name, amount, stage, close_date, created_at, updated_at
   FROM deals WHERE stage = ? ORDER BY updated_at DESC`,
);
const stmtUpdateDeal = db.prepare(`
  UPDATE deals SET
    name = COALESCE(NULLIF(?, ''), name),
    amount = COALESCE(NULLIF(?, ''), amount),
    stage = COALESCE(NULLIF(?, ''), stage),
    close_date = COALESCE(NULLIF(?, ''), close_date),
    updated_at = ?
  WHERE id = ?
`);

export interface DealInput {
  id?: string;
  contactId?: string;
  company?: string;
  name: string;
  amount?: string;
  stage?: string;
  closeDate?: string;
}

export interface DealRow {
  id: string;
  contact_id: string | null;
  company: string;
  name: string;
  amount: string;
  stage: string;
  close_date: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertDeal(d: DealInput): DealRow {
  const now = new Date().toISOString();
  if (d.id) {
    stmtUpdateDeal.run(d.name ?? '', d.amount ?? '', d.stage ?? '', d.closeDate ?? '', now, d.id);
    const row = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(d.id) as DealRow | undefined;
    if (row) return row;
  }
  const id = d.id ?? randomUUID();
  stmtInsertDeal.run(
    id,
    d.contactId ?? null,
    d.company ?? '',
    d.name,
    d.amount ?? '',
    d.stage ?? '',
    d.closeDate ?? null,
    now,
    now,
  );
  return {
    id,
    contact_id: d.contactId ?? null,
    company: d.company ?? '',
    name: d.name,
    amount: d.amount ?? '',
    stage: d.stage ?? '',
    close_date: d.closeDate ?? null,
    created_at: now,
    updated_at: now,
  };
}

export function listDeals(filter?: { contactId?: string; stage?: string }): DealRow[] {
  if (filter?.contactId) return stmtListDealsByContact.all(filter.contactId) as DealRow[];
  if (filter?.stage) return stmtListDealsByStage.all(filter.stage) as DealRow[];
  return stmtListDeals.all() as DealRow[];
}

// ─── Rate state (for rate-limiter.ts) ────────────────────────────────────

const stmtGetRateRow = db.prepare(
  'SELECT count, last_action_at FROM rate_state WHERE action_type = ? AND window_key = ?',
);
const stmtUpsertRateRow = db.prepare(`
  INSERT INTO rate_state (action_type, window_key, count, last_action_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(action_type, window_key) DO UPDATE SET
    count = excluded.count,
    last_action_at = excluded.last_action_at
`);
const stmtAllRateRows = db.prepare(
  'SELECT action_type, window_key, count, last_action_at FROM rate_state ORDER BY action_type, window_key',
);
const stmtDeleteOldRateRows = db.prepare(
  "DELETE FROM rate_state WHERE window_key < ? AND substr(window_key, 1, 4) = 'day:'",
);

export function getRateCount(actionType: string, windowKey: string): { count: number; lastActionAt: string } {
  const row = stmtGetRateRow.get(actionType, windowKey) as
    | { count: number; last_action_at: string }
    | undefined;
  return { count: row?.count ?? 0, lastActionAt: row?.last_action_at ?? '' };
}

export function recordRateAction(actionType: string, windowKey: string): void {
  const { count } = getRateCount(actionType, windowKey);
  stmtUpsertRateRow.run(actionType, windowKey, count + 1, new Date().toISOString());
}

export function allRateRows(): Array<{
  action_type: string;
  window_key: string;
  count: number;
  last_action_at: string;
}> {
  return stmtAllRateRows.all() as Array<{
    action_type: string;
    window_key: string;
    count: number;
    last_action_at: string;
  }>;
}

export function pruneRateRowsBefore(windowKey: string): number {
  return stmtDeleteOldRateRows.run(windowKey).changes;
}
