#!/usr/bin/env node
/**
 * Unified tracker CLI.
 *
 * Commands:
 *   tracker.ts read                                  → print all contact_ids (JSON)
 *   tracker.ts rows                                  → print all rows
 *   tracker.ts find <identifier>                     → resolve email / linkedin_url / contact_id / crm_id
 *   tracker.ts upsert --json '<partial row JSON>'    → idempotent create/update by identifier
 *   tracker.ts score <contact_id> <fit> <eng> <tier>
 *   tracker.ts status <contact_id> <status>
 *   tracker.ts skip <contact_id> <reason>         → mark do_not_contact
 *                                                    reasons: bounce | unsubscribe | negative_hard | manual | "" (clear)
 *   tracker.ts reply <contact_id> <channel> <classification> [snippet]
 *   tracker.ts export [--format json|tsv] [--out path]
 *
 * `<identifier>` for `find` is auto-detected:
 *   - starts with "http" and matches linkedin.com → linkedin_url
 *   - contains "@" → email
 *   - UUID-like → contact_id
 *   - everything else → tries all three, last wins
 */

import { writeFileSync } from 'fs';
import {
  allRows,
  findContact,
  upsertContact,
  updateScores,
  updateStatus,
  updateDoNotContact,
  updateReply,
  TRACKER_COLUMNS,
  type TrackerRow,
  normalizeEmail,
  normalizeLinkedInUrl,
} from './db.ts';

const VALID_SKIP_REASONS = ['bounce', 'unsubscribe', 'negative_hard', 'manual', ''];

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = 'true';
    }
  }
  return flags;
}

function rowsToTsv(rows: TrackerRow[]): string {
  const header = TRACKER_COLUMNS.join('\t');
  const body = rows.map((r) =>
    TRACKER_COLUMNS.map((c) => (r[c] ?? '').replace(/[\t\n\r]/g, ' ')).join('\t'),
  );
  return [header, ...body].join('\n') + '\n';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function autoFind(idToken: string): TrackerRow | null {
  if (UUID_RE.test(idToken)) return findContact({ contact_id: idToken });
  if (/^https?:\/\/.*linkedin\.com\//i.test(idToken)) {
    return findContact({ linkedin_url: normalizeLinkedInUrl(idToken) });
  }
  if (idToken.includes('@')) return findContact({ email: normalizeEmail(idToken) });
  // Fall-back: try each in turn
  return (
    findContact({ contact_id: idToken }) ||
    findContact({ linkedin_url: idToken }) ||
    findContact({ email: idToken })
  );
}

const [, , command, ...args] = process.argv;

switch (command) {
  case 'read': {
    const ids = allRows().map((r) => r.contact_id);
    console.log(JSON.stringify(ids, null, 2));
    break;
  }
  case 'rows': {
    console.log(JSON.stringify(allRows(), null, 2));
    break;
  }
  case 'find': {
    const id = args[0];
    if (!id) {
      console.error('Usage: tracker.ts find <identifier>');
      process.exit(1);
    }
    const row = autoFind(id);
    if (!row) {
      console.error(`No row for "${id}"`);
      process.exit(1);
    }
    console.log(JSON.stringify(row, null, 2));
    break;
  }
  case 'upsert': {
    const flags = parseFlags(args);
    const json = flags.json;
    if (!json || json === 'true') {
      console.error(`Usage: tracker.ts upsert --json '{"email":"...","firstname":"..."}'`);
      process.exit(1);
    }
    let input: Record<string, string>;
    try {
      input = JSON.parse(json);
    } catch {
      console.error('Invalid JSON');
      process.exit(1);
    }
    const row = upsertContact(input);
    console.log(JSON.stringify(row, null, 2));
    break;
  }
  case 'score': {
    const [contactId, fitStr, engStr, tier] = args;
    if (!contactId || !fitStr || !engStr || !tier) {
      console.error('Usage: tracker.ts score <contact_id> <fit> <eng> <tier>');
      process.exit(1);
    }
    if (!updateScores(contactId, Number(fitStr), Number(engStr), tier)) {
      console.error(`No row for contact_id ${contactId}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ contact_id: contactId, fit_score: Number(fitStr), engagement_score: Number(engStr), priority_tier: tier }));
    break;
  }
  case 'status': {
    const [contactId, status] = args;
    if (!contactId || !status) {
      console.error('Usage: tracker.ts status <contact_id> <status>');
      process.exit(1);
    }
    if (!updateStatus(contactId, status)) {
      console.error(`No row for contact_id ${contactId}`);
      process.exit(1);
    }
    console.log(`Status set: ${contactId} → ${status}`);
    break;
  }
  case 'skip': {
    const [contactId, reason] = args;
    if (!contactId || reason === undefined) {
      console.error(
        `Usage: tracker.ts skip <contact_id> <${VALID_SKIP_REASONS.filter(Boolean).join('|')}|"">`,
      );
      process.exit(1);
    }
    if (!VALID_SKIP_REASONS.includes(reason)) {
      console.error(
        `reason must be one of: ${VALID_SKIP_REASONS.filter(Boolean).join(', ')} (or "" to clear)`,
      );
      process.exit(1);
    }
    if (!updateDoNotContact(contactId, reason)) {
      console.error(`No row for contact_id ${contactId}`);
      process.exit(1);
    }
    console.log(`do_not_contact set: ${contactId} → ${reason || '(cleared)'}`);
    break;
  }
  case 'reply': {
    const [contactId, channel, classification, ...snippetParts] = args;
    if (!contactId || !channel || !classification) {
      console.error('Usage: tracker.ts reply <contact_id> <email|linkedin> <classification> [snippet]');
      process.exit(1);
    }
    if (channel !== 'email' && channel !== 'linkedin') {
      console.error(`channel must be 'email' or 'linkedin', got "${channel}"`);
      process.exit(1);
    }
    const snippet = snippetParts.join(' ');
    if (!updateReply(contactId, channel, classification, snippet)) {
      console.error(`No row for contact_id ${contactId}`);
      process.exit(1);
    }
    console.log(`Reply logged: ${contactId} → ${channel}/${classification}`);
    break;
  }
  case 'export': {
    const flags = parseFlags(args);
    const format = flags.format ?? 'json';
    const outPath = flags.out;
    if (format !== 'json' && format !== 'tsv') {
      console.error('format must be json or tsv');
      process.exit(1);
    }
    const rows = allRows();
    const out = format === 'json' ? JSON.stringify(rows, null, 2) : rowsToTsv(rows);
    if (outPath) {
      writeFileSync(outPath, out, 'utf-8');
      console.error(`Exported ${rows.length} rows → ${outPath} (${format}).`);
    } else {
      process.stdout.write(out);
      if (format === 'json') process.stdout.write('\n');
    }
    break;
  }
  default:
    console.error(
      'Usage: tsx src/tracker.ts read | rows | find <identifier> | upsert --json <json> | score <id> <fit> <eng> <tier> | status <id> <status> | skip <id> <bounce|unsubscribe|negative_hard|manual|""> | reply <id> <email|linkedin> <classification> [snippet] | export [--format json|tsv] [--out path]',
    );
    process.exit(1);
}
