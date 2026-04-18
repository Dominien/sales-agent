#!/usr/bin/env node
/**
 * Cohort builder — produce a deterministic, auditable queue of tracker rows
 * for an outreach skill to work through.
 *
 * The retrospective on Wave 1 called out that cohort filtering had lived as
 * inline `tsx -e "..."` blobs. That was non-reusable, non-testable, and hid
 * exclusion reasons. This module makes the filtering first-class:
 *
 *   buildCohort({tier: ['A','B'], channel: 'linkedin', excludeSkipTiers: ['hard','warm']})
 *     → {included: TrackerRow[], excluded: {row, reason}[]}
 *
 * CLI:
 *   cohort-builder.ts build [--tier A,B] [--channel email|linkedin]
 *                           [--allow-skip personal] [--limit N]
 *                           [--format json|summary]
 *
 * Skills should call this once at the top of a run, log the exclusion
 * summary to the learnings heartbeat, then iterate `included`.
 */

import { allRows, type TrackerRow } from './db.ts';
import { classifySkip, type SkipReason, type SkipTier } from './skip-flags.ts';

export type Tier = 'A' | 'B' | 'C' | 'D';
export type Channel = 'email' | 'linkedin';

export interface CohortSpec {
  /** Priority tiers to include. Default: ['A', 'B']. */
  tier?: Tier[];
  /** Channel gate. If set, requires the contact to have the matching identifier. */
  channel?: Channel;
  /**
   * Skip tiers the skill wants to tolerate (e.g. a life-event re-engage
   * campaign may allow `personal`). Default: [] (reject all skips).
   */
  excludeSkipTiers?: SkipTier[];
  /** Hard cap on the returned `included` array length after sorting. */
  limit?: number;
  /** Optional lead-status allow-list (case-insensitive). */
  leadStatus?: string[];
  /** If true, only rows that have NEVER been contacted on the target channel. */
  untouchedOnly?: boolean;
}

export interface Exclusion {
  row: TrackerRow;
  reason: string;
  detail?: string;
}

export interface Cohort {
  included: TrackerRow[];
  excluded: Exclusion[];
  spec: CohortSpec;
  totals: {
    scanned: number;
    included: number;
    excluded_by: Record<string, number>;
  };
}

const TIER_ORDER: Record<Tier, number> = { A: 1, B: 2, C: 3, D: 4 };

function byPriorityThenFit(a: TrackerRow, b: TrackerRow): number {
  const ta = TIER_ORDER[(a.priority_tier as Tier) || 'D'] ?? 5;
  const tb = TIER_ORDER[(b.priority_tier as Tier) || 'D'] ?? 5;
  if (ta !== tb) return ta - tb;
  const fa = Number(a.fit_score) || 0;
  const fb = Number(b.fit_score) || 0;
  return fb - fa;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildCohort(spec: CohortSpec = {}): Cohort {
  const tier: Tier[] = spec.tier ?? ['A', 'B'];
  const allowSkip = spec.excludeSkipTiers ?? [];
  const leadStatuses = (spec.leadStatus ?? []).map((s) => s.toUpperCase());

  const included: TrackerRow[] = [];
  const excluded: Exclusion[] = [];
  const by: Record<string, number> = {};

  for (const row of allRows()) {
    const t = (row.priority_tier as Tier) || '';
    if (t && !tier.includes(t)) {
      excluded.push({ row, reason: 'tier_mismatch', detail: `tier=${t || '(unset)'}` });
      bump(by, 'tier_mismatch');
      continue;
    }
    if (!t) {
      // Unscored rows — excluded by default. Explicit re-scoring must happen
      // via scoring.ts before they can enter a cohort.
      excluded.push({ row, reason: 'unscored' });
      bump(by, 'unscored');
      continue;
    }

    if (spec.channel === 'email' && !row.email) {
      excluded.push({ row, reason: 'no_email' });
      bump(by, 'no_email');
      continue;
    }
    if (spec.channel === 'linkedin' && !row.linkedin_url) {
      excluded.push({ row, reason: 'no_linkedin_url' });
      bump(by, 'no_linkedin_url');
      continue;
    }

    if (spec.untouchedOnly && spec.channel === 'email' && row.email_last_drafted_at) {
      excluded.push({ row, reason: 'already_touched_email' });
      bump(by, 'already_touched_email');
      continue;
    }
    if (
      spec.untouchedOnly &&
      spec.channel === 'linkedin' &&
      (row.linkedin_connection_sent_at || row.linkedin_last_message_at)
    ) {
      excluded.push({ row, reason: 'already_touched_linkedin' });
      bump(by, 'already_touched_linkedin');
      continue;
    }

    if (leadStatuses.length && !leadStatuses.includes((row.lead_status || '').toUpperCase())) {
      excluded.push({
        row,
        reason: 'lead_status_mismatch',
        detail: `lead_status=${row.lead_status || '(unset)'}`,
      });
      bump(by, 'lead_status_mismatch');
      continue;
    }

    const skip: SkipReason | null = classifySkip(row);
    if (skip && !allowSkip.includes(skip.tier)) {
      const reasonKey = `skip_${skip.tier}`;
      excluded.push({
        row,
        reason: reasonKey,
        detail: `${skip.code} (${skip.source}: "${skip.matched}")`,
      });
      bump(by, reasonKey);
      continue;
    }

    included.push(row);
  }

  included.sort(byPriorityThenFit);
  const capped = spec.limit !== undefined ? included.slice(0, spec.limit) : included;
  if (spec.limit !== undefined && included.length > spec.limit) {
    for (const row of included.slice(spec.limit)) {
      excluded.push({ row, reason: 'limit_capped' });
      bump(by, 'limit_capped');
    }
  }

  return {
    included: capped,
    excluded,
    spec,
    totals: {
      scanned: capped.length + excluded.length,
      included: capped.length,
      excluded_by: by,
    },
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command, ...rest] = process.argv;
  if (command !== 'build') {
    console.error(
      'Usage: tsx src/cohort-builder.ts build [--tier A,B] [--channel email|linkedin] ' +
        '[--allow-skip personal,warm] [--lead-status NEW,OPEN_DEAL] [--untouched] ' +
        '[--limit N] [--format json|summary]',
    );
    process.exit(2);
  }
  const flags = parseFlags(rest);
  const spec: CohortSpec = {
    tier: (parseList(flags.tier) as Tier[] | undefined) ?? undefined,
    channel: (flags.channel as Channel) || undefined,
    excludeSkipTiers: (parseList(flags['allow-skip']) as SkipTier[] | undefined) ?? undefined,
    leadStatus: parseList(flags['lead-status']),
    untouchedOnly: flags.untouched === 'true',
    limit: flags.limit ? Number(flags.limit) : undefined,
  };
  const cohort = buildCohort(spec);

  if (flags.format === 'summary') {
    console.log(
      `Cohort: ${cohort.totals.included} included / ${cohort.totals.scanned} scanned.`,
    );
    console.log('Excluded by:');
    for (const [k, n] of Object.entries(cohort.totals.excluded_by).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(28)} ${n}`);
    }
  } else {
    console.log(JSON.stringify(cohort, null, 2));
  }
}
