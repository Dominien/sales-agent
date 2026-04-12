#!/usr/bin/env node
/**
 * Deterministic performance analytics. Joins outbound touches → inbound replies
 * across all channels and CRM sources, segments by (channel × skill × lead_status),
 * and surfaces statistically meaningful contrasts.
 *
 * Usage:
 *   performance.ts [--window <days>] [--since <ISO>] [--until <ISO>]
 *
 * Thresholds:
 *   MIN_BUCKET_SIZE     = 5
 *   MIN_DELTA           = 0.15
 *   PROPOSABLE_EVIDENCE = 10
 */

import { rowsInWindow, type TrackerRow } from './db.ts';

const MIN_BUCKET_SIZE = 5;
const MIN_DELTA = 0.15;
const PROPOSABLE_EVIDENCE = 10;

type SkillTag =
  | 'cold-outreach'
  | 'follow-up-loop'
  | 'research-outreach'
  | 'compose-reply'
  | 'inbox-classifier'
  | 'unknown';

type ChannelTag = 'email' | 'linkedin' | 'unknown';

interface Feature {
  contact_id: string;
  channel: ChannelTag;
  skill: SkillTag;
  crm_source: string;
  lead_status: string;
  touchAt: string;
  outcome: string;
  hasReply: boolean;
  isPositive: boolean;
  isNegative: boolean;
  linkedinAccepted: boolean;
}

interface Bucket {
  value: string;
  touches: number;
  replies: number;
  positive: number;
  negative: number;
  accept_rate: number;   // LinkedIn only
  reply_rate: number;
  positive_rate: number;
}

interface Contrast {
  base_dim: string;
  base_value: string;
  contrast_dim: string;
  contrast_value: string;
  bucket_n: number;
  other_n: number;
  bucket_positive_rate: number;
  other_positive_rate: number;
  delta: number;
  proposable: boolean;
  strong: boolean;
}

type Args = Record<string, string | true | undefined>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}

const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const parseIso = (s: string) => (s ? (isNaN(new Date(s).getTime()) ? null : new Date(s)) : null);

function inferSkill(notes: string, status: string): SkillTag {
  const t = notes.trim();
  if (t.startsWith('RES:')) return 'research-outreach';
  if (t.startsWith('COMPOSE:')) return 'compose-reply';
  if (t.startsWith('COLD:')) return 'cold-outreach';
  if (t.startsWith('FU:')) return 'follow-up-loop';
  if (t.startsWith('INBOUND:')) return 'inbox-classifier';
  if (['sent', 'skipped', 'error', 'replied', 'drafted'].includes(status)) return 'follow-up-loop';
  return 'unknown';
}

function inferChannel(row: TrackerRow): ChannelTag {
  // Prefer reply_channel if present (ground truth for recent touch).
  if (row.reply_channel === 'email' || row.reply_channel === 'linkedin') return row.reply_channel;
  // Otherwise: which channel had more recent touch.
  const email = parseIso(row.email_last_drafted_at)?.getTime() ?? 0;
  const li = parseIso(row.linkedin_last_message_at)?.getTime() ??
             parseIso(row.linkedin_connection_sent_at)?.getTime() ?? 0;
  if (li > email && li > 0) return 'linkedin';
  if (email > 0) return 'email';
  return 'unknown';
}

function resolveWindow(a: Args) {
  const since = str(a, 'since');
  const until = str(a, 'until');
  const winDays = str(a, 'window');
  const now = new Date();
  if (since || until) {
    return {
      start: since ? parseIso(since) ?? new Date(0) : new Date(0),
      end: until ? parseIso(until) ?? now : now,
      days: null as number | null,
    };
  }
  const days = winDays ? Math.max(1, parseInt(winDays, 10) || 7) : 7;
  return { start: new Date(now.getTime() - days * 86_400_000), end: now, days };
}

function extractFeatures(rows: TrackerRow[]): Feature[] {
  const out: Feature[] = [];
  for (const row of rows) {
    const touchAt =
      parseIso(row.linkedin_last_message_at)?.toISOString() ||
      parseIso(row.email_last_drafted_at)?.toISOString() ||
      parseIso(row.linkedin_connection_sent_at)?.toISOString() ||
      '';
    if (!touchAt) continue;
    const classification = row.reply_classification.trim();
    const hasReply = classification.length > 0;
    out.push({
      contact_id: row.contact_id,
      channel: inferChannel(row),
      skill: inferSkill(row.notes_summary, row.status),
      crm_source: row.crm_source || 'sqlite',
      lead_status: (row.lead_status || '(unset)').trim() || '(unset)',
      touchAt,
      outcome: hasReply ? classification : 'no_reply',
      hasReply,
      isPositive: hasReply && classification.startsWith('POSITIVE'),
      isNegative: hasReply && classification.startsWith('NEGATIVE'),
      linkedinAccepted:
        row.linkedin_connection_status === 'CONNECTED' ||
        (row.linkedin_connection_accepted_at || '').length > 0,
    });
  }
  return out;
}

function bucket(features: Feature[], key: (f: Feature) => string): Bucket[] {
  const groups = new Map<string, Feature[]>();
  for (const f of features) {
    const k = key(f);
    (groups.get(k) || groups.set(k, []).get(k))!.push(f);
  }
  const out: Bucket[] = [];
  for (const [value, arr] of groups) {
    const touches = arr.length;
    const replies = arr.filter((f) => f.hasReply).length;
    const positive = arr.filter((f) => f.isPositive).length;
    const negative = arr.filter((f) => f.isNegative).length;
    const liAttempts = arr.filter((f) => f.channel === 'linkedin').length;
    const liAccepts = arr.filter((f) => f.channel === 'linkedin' && f.linkedinAccepted).length;
    out.push({
      value,
      touches,
      replies,
      positive,
      negative,
      accept_rate: liAttempts ? round3(liAccepts / liAttempts) : 0,
      reply_rate: touches ? round3(replies / touches) : 0,
      positive_rate: touches ? round3(positive / touches) : 0,
    });
  }
  out.sort((a, b) => b.touches - a.touches);
  return out;
}

function contrasts(features: Feature[]): Contrast[] {
  const out: Contrast[] = [];
  // Contrast skills WITHIN each (channel × lead_status) segment.
  const groups = new Map<string, Feature[]>();
  for (const f of features) {
    const k = `${f.channel}||${f.lead_status}`;
    (groups.get(k) || groups.set(k, []).get(k))!.push(f);
  }
  for (const [k, subset] of groups) {
    const [channel, lead_status] = k.split('||');
    const skills = new Set(subset.map((f) => f.skill));
    for (const skill of skills) {
      const b = subset.filter((f) => f.skill === skill);
      const o = subset.filter((f) => f.skill !== skill);
      if (b.length < MIN_BUCKET_SIZE || o.length < MIN_BUCKET_SIZE) continue;
      const bP = b.filter((f) => f.isPositive).length / b.length;
      const oP = o.filter((f) => f.isPositive).length / o.length;
      const delta = bP - oP;
      if (Math.abs(delta) < MIN_DELTA) continue;
      const ev = b.length + o.length;
      out.push({
        base_dim: `channel×lead_status`,
        base_value: `${channel}, ${lead_status}`,
        contrast_dim: 'skill',
        contrast_value: skill,
        bucket_n: b.length,
        other_n: o.length,
        bucket_positive_rate: round3(bP),
        other_positive_rate: round3(oP),
        delta: round3(delta),
        proposable: ev >= PROPOSABLE_EVIDENCE,
        strong: ev >= 20 && Math.abs(delta) >= 0.25,
      });
    }
  }
  return out;
}

function breakdown(features: Feature[], predicate: (c: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of features) {
    if (f.hasReply && predicate(f.outcome)) out[f.outcome] = (out[f.outcome] || 0) + 1;
  }
  return out;
}

const a = parseArgs(process.argv.slice(2));
const w = resolveWindow(a);
const rows = rowsInWindow(w.start.toISOString(), w.end.toISOString());
const features = extractFeatures(rows);

const touches = features.length;
const replies = features.filter((f) => f.hasReply).length;
const positive = features.filter((f) => f.isPositive).length;
const negative = features.filter((f) => f.isNegative).length;
const li = features.filter((f) => f.channel === 'linkedin');
const liAccepted = li.filter((f) => f.linkedinAccepted).length;

const totals = {
  touches,
  replies,
  positive,
  negative,
  linkedin_accept_rate: li.length ? round3(liAccepted / li.length) : 0,
  reply_rate: touches ? round3(replies / touches) : 0,
  positive_rate: touches ? round3(positive / touches) : 0,
};

const warnings: string[] = [];
if (touches === 0) warnings.push('No touches in window — report is empty.');
if (touches > 0 && touches < 10) warnings.push('Very small sample (<10) — contrasts unreliable.');

const report = {
  window: { start: w.start.toISOString(), end: w.end.toISOString(), days: w.days },
  totals,
  positive_breakdown: breakdown(features, (c) => c.startsWith('POSITIVE')),
  negative_breakdown: breakdown(features, (c) => c.startsWith('NEGATIVE')),
  by_channel: bucket(features, (f) => f.channel),
  by_skill: bucket(features, (f) => f.skill),
  by_lead_status: bucket(features, (f) => f.lead_status),
  by_crm_source: bucket(features, (f) => f.crm_source),
  by_channel_x_skill: bucket(features, (f) => `${f.channel} × ${f.skill}`),
  contrasts: contrasts(features),
  data_warnings: warnings,
};

console.log(JSON.stringify(report, null, 2));
