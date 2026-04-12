#!/usr/bin/env node
/**
 * Lead scoring — fit × engagement → priority tier (A/B/C/D).
 *
 * Fit inputs come from whichever identity data is present (LinkedIn profile,
 * CRM contact record, or user-supplied JSON).
 * Engagement inputs come from the tracker: connection status, reply history,
 * recency, skill-tag prefix in notes_summary.
 *
 * Usage:
 *   scoring.ts score <contact_id> [--data <json>]  → recompute one row
 *   scoring.ts score-tracker                       → recompute all rows (engagement only if no fit data)
 *   scoring.ts rank                                → list by tier
 *   scoring.ts tier <contact_id>                   → print tier for a row
 *   scoring.ts update <contact_id> <fit> <eng>     → manual override
 *
 * Configuration: knowledge/scoring-config.md
 */

import {
  allRows,
  findContact,
  updateScores,
  rowsByPriority,
  type TrackerRow,
} from './db.ts';

// ─── Engagement (tracker-only) ────────────────────────────────────────────

interface EngagementInput {
  linkedinConnectionStatus: string;
  replyClassification: string;
  replyReceivedAt: string;
  lastEmailDraftedAt: string;
  lastLinkedinMessageAt: string;
  notesSummary: string;
  status: string;
}

function computeEngagement(input: EngagementInput): number {
  let score = 0;
  const cl = input.replyClassification.trim();

  // LinkedIn connection state
  if (input.linkedinConnectionStatus === 'CONNECTED') score += 20;
  else if (input.linkedinConnectionStatus === 'REQUEST_SENT') score += 5;
  else if (input.linkedinConnectionStatus === 'DECLINED') score -= 15;

  // Reply sentiment
  if (cl.startsWith('POSITIVE')) score += 40;
  else if (cl && cl !== 'BOUNCE' && cl !== 'SPAM_FLAG' && cl !== 'NEGATIVE_HARD') score += 15;

  // Recency of reply
  if (input.replyReceivedAt) {
    const days = (Date.now() - new Date(input.replyReceivedAt).getTime()) / 86_400_000;
    if (days <= 30) score += 15;
    else if (days <= 90) score += 10;
  }

  // Did we actually reach out?
  if (input.lastEmailDraftedAt || input.lastLinkedinMessageAt) score += 5;
  if (input.status === 'sent' || input.status === 'drafted') score += 5;

  // Skill-tag signal
  const ns = input.notesSummary.trim();
  if (ns.startsWith('RES:')) score += 10;
  if (ns.startsWith('COMPOSE:')) score += 5;

  // Penalties
  if (cl === 'NEGATIVE_HARD') score -= 20;
  if (cl === 'BOUNCE') score -= 30;

  return Math.max(0, Math.min(100, score));
}

// ─── Fit (identity data from profile / CRM) ──────────────────────────────

export interface FitInput {
  industry?: string;
  company_size?: string | number;
  job_title?: string;
  headline?: string;
  location?: string;
}

function computeFit(input: FitInput): number {
  let score = 0;

  // Industry (0–30) — customize in knowledge/scoring-config.md
  const industry = (input.industry || '').trim().toLowerCase();
  score += industry ? 20 : 5;

  // Company size (0–25)
  const sizeStr = String(input.company_size ?? '');
  const m = sizeStr.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  if (!isNaN(n)) {
    if (n >= 10 && n <= 200) score += 25;
    else if (n >= 1 && n < 10) score += 15;
    else if (n > 200 && n <= 1000) score += 15;
    else score += 10;
  } else if (sizeStr) score += 12;
  else score += 8;

  // Title / headline (0–30)
  const title = `${input.job_title || ''} ${input.headline || ''}`.trim().toLowerCase();
  if (title) {
    if (/\b(ceo|founder|co-founder|owner|geschäftsführer|inhaber|managing director|cto|coo|cmo|cfo)\b/.test(title)) score += 30;
    else if (/\b(vp|vice president|director|head of|leiter|partner)\b/.test(title)) score += 22;
    else if (/\b(manager|lead|teamlead|team lead|principal)\b/.test(title)) score += 15;
    else score += 5;
  } else score += 10;

  // Location (0–15)
  score += (input.location || '').trim() ? 10 : 5;

  return Math.max(0, Math.min(100, score));
}

// ─── Tier matrix ─────────────────────────────────────────────────────────

export function deriveTier(fit: number, eng: number): 'A' | 'B' | 'C' | 'D' {
  const f = fit >= 71 ? 'high' : fit >= 41 ? 'med' : 'low';
  const e = eng >= 61 ? 'high' : eng >= 31 ? 'med' : 'low';
  if (f === 'high' && e !== 'low') return 'A';
  if (f === 'med' && e === 'high') return 'A';
  if (f === 'high' && e === 'low') return 'B';
  if (f === 'med' && e === 'med') return 'B';
  if (f === 'low' && e === 'high') return 'B';
  if (f === 'med' && e === 'low') return 'C';
  if (f === 'low' && e === 'med') return 'C';
  return 'D';
}

function engagementFromRow(row: TrackerRow): EngagementInput {
  return {
    linkedinConnectionStatus: row.linkedin_connection_status,
    replyClassification: row.reply_classification,
    replyReceivedAt: row.reply_received_at,
    lastEmailDraftedAt: row.email_last_drafted_at,
    lastLinkedinMessageAt: row.linkedin_last_message_at,
    notesSummary: row.notes_summary,
    status: row.status,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case 'score': {
    const id = args[0];
    if (!id) {
      console.error('Usage: scoring.ts score <contact_id> [--data <json>]');
      process.exit(1);
    }
    let fitData: FitInput = {};
    const d = args.indexOf('--data');
    if (d !== -1 && args[d + 1]) {
      try {
        fitData = JSON.parse(args[d + 1]);
      } catch {
        console.error('Invalid JSON for --data');
        process.exit(1);
      }
    }
    const row = findContact({ contact_id: id });
    if (!row) {
      console.error(`No row for contact_id ${id}`);
      process.exit(1);
    }
    const fit = Object.keys(fitData).length ? computeFit(fitData) : parseInt(row.fit_score, 10) || 50;
    const eng = computeEngagement(engagementFromRow(row));
    const tier = deriveTier(fit, eng);
    updateScores(id, fit, eng, tier);
    console.log(JSON.stringify({ contact_id: id, fit_score: fit, engagement_score: eng, priority_tier: tier }));
    break;
  }
  case 'score-tracker': {
    const rows = allRows();
    const out: Array<{contact_id: string; fit_score: number; engagement_score: number; priority_tier: string}> = [];
    for (const row of rows) {
      const existingFit = parseInt(row.fit_score, 10);
      const fit = isNaN(existingFit) || row.fit_score === '' ? 50 : existingFit;
      const eng = computeEngagement(engagementFromRow(row));
      const tier = deriveTier(fit, eng);
      updateScores(row.contact_id, fit, eng, tier);
      out.push({ contact_id: row.contact_id, fit_score: fit, engagement_score: eng, priority_tier: tier });
    }
    console.log(JSON.stringify(out, null, 2));
    console.error(`Scored ${out.length} contacts.`);
    break;
  }
  case 'rank': {
    const ranked = rowsByPriority();
    if (ranked.length === 0) {
      console.log('No scored contacts. Run `scoring.ts score-tracker` first.');
      break;
    }
    console.log(JSON.stringify(
      ranked.map((r) => ({
        contact_id: r.contact_id,
        name: `${r.firstname} ${r.lastname}`.trim(),
        company: r.company,
        tier: r.priority_tier,
        fit: r.fit_score,
        engagement: r.engagement_score,
        email: r.email,
        linkedin_url: r.linkedin_url,
        crm_source: r.crm_source,
      })),
      null,
      2,
    ));
    break;
  }
  case 'tier': {
    const id = args[0];
    const row = findContact({ contact_id: id });
    if (!row) {
      console.error(`No row for ${id}`);
      process.exit(1);
    }
    console.log(row.priority_tier || '(unscored)');
    break;
  }
  case 'update': {
    const [id, fitStr, engStr] = args;
    if (!id || !fitStr || !engStr) {
      console.error('Usage: scoring.ts update <contact_id> <fit> <eng>');
      process.exit(1);
    }
    const row = findContact({ contact_id: id });
    if (!row) {
      console.error(`No row for ${id}`);
      process.exit(1);
    }
    const fit = Math.max(0, Math.min(100, parseInt(fitStr, 10) || 0));
    const eng = Math.max(0, Math.min(100, parseInt(engStr, 10) || 0));
    const tier = deriveTier(fit, eng);
    updateScores(id, fit, eng, tier);
    console.log(JSON.stringify({ contact_id: id, fit_score: fit, engagement_score: eng, priority_tier: tier }));
    break;
  }
  default:
    console.error('Usage: tsx src/scoring.ts score <id> [--data <json>] | score-tracker | rank | tier <id> | update <id> <fit> <eng>');
    process.exit(1);
}
