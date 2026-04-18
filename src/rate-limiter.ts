#!/usr/bin/env node
/**
 * Per-channel rate limiter. Mandatory check before every outbound action.
 *
 * Actions recognized:
 *   - email_draft             (daily cap only)
 *   - linkedin_connect        (daily + weekly)
 *   - linkedin_message        (daily)
 *   - linkedin_connect_note   (monthly — LinkedIn free-tier personalized-note
 *                              cap, typically ~5/month; set to a cap the user
 *                              has ground-truthed for their account)
 *
 * Limits come from agent.config.json → rate_limits. If the config can't be
 * loaded (e.g., running during init), hard defaults are used.
 *
 * Usage:
 *   rate-limiter.ts check    <action>   → exit 0 = ok, exit 1 = blocked
 *   rate-limiter.ts record   <action>   → increment counter
 *   rate-limiter.ts saturate <action>   → force counter to cap (used to
 *                                         auto-exhaust note budget after a
 *                                         silent note-drop is observed)
 *   rate-limiter.ts reset    <action> [day|week|month|all]
 *                                       → clear counter for the current window
 *                                         (recovery from misrecords/tests)
 *   rate-limiter.ts status
 *   rate-limiter.ts prune
 */

import {
  getRateCount,
  recordRateAction,
  saturateRateAction,
  resetRateAction,
  allRateRows,
  pruneRateRowsBefore,
} from './db.ts';
import { loadConfig, ConfigError } from './config.ts';

export type Action =
  | 'email_draft'
  | 'linkedin_connect'
  | 'linkedin_message'
  | 'linkedin_connect_note';
const VALID_ACTIONS: Action[] = [
  'email_draft',
  'linkedin_connect',
  'linkedin_message',
  'linkedin_connect_note',
];

interface Limit {
  daily?: number;
  weekly?: number;
  monthly?: number;
}

const HARD_DEFAULTS: Record<Action, Limit> = {
  email_draft: { daily: 200 },
  linkedin_connect: { daily: 20, weekly: 80 },
  linkedin_message: { daily: 40 },
  // Free-tier default. User overrides via agent.config.json if they have
  // Premium (higher cap) or prefer a stricter budget.
  linkedin_connect_note: { monthly: 5 },
};

function resolveLimits(): Record<Action, Limit> {
  try {
    const cfg = loadConfig();
    return {
      email_draft: cfg.rate_limits.email_draft ?? HARD_DEFAULTS.email_draft,
      linkedin_connect: cfg.rate_limits.linkedin_connect ?? HARD_DEFAULTS.linkedin_connect,
      linkedin_message: cfg.rate_limits.linkedin_message ?? HARD_DEFAULTS.linkedin_message,
      linkedin_connect_note:
        cfg.rate_limits.linkedin_connect_note ?? HARD_DEFAULTS.linkedin_connect_note,
    };
  } catch (e) {
    if (e instanceof ConfigError) return HARD_DEFAULTS;
    throw e;
  }
}

function todayKey(): string {
  return `day:${new Date().toISOString().slice(0, 10)}`;
}

function isoWeekKey(): string {
  const d = new Date();
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `week:${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function monthKey(): string {
  const now = new Date();
  return `month:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function assertValidAction(a: string): asserts a is Action {
  if (!VALID_ACTIONS.includes(a as Action)) {
    console.error(`Unknown action: ${a}. Use one of: ${VALID_ACTIONS.join(', ')}`);
    process.exit(2);
  }
}

export interface CheckResult {
  ok: boolean;
  reason?: string;
  daily: number;
  weekly: number;
  monthly: number;
  limit_daily: number | null;
  limit_weekly: number | null;
  limit_monthly: number | null;
}

export function check(action: Action): CheckResult {
  const limits = resolveLimits()[action];
  const daily = getRateCount(action, todayKey()).count;
  const weekly = getRateCount(action, isoWeekKey()).count;
  const monthly = getRateCount(action, monthKey()).count;
  const base = {
    daily,
    weekly,
    monthly,
    limit_daily: limits.daily ?? null,
    limit_weekly: limits.weekly ?? null,
    limit_monthly: limits.monthly ?? null,
  };
  if (limits.daily !== undefined && daily >= limits.daily) {
    return { ...base, ok: false, reason: `Daily cap reached (${daily}/${limits.daily})` };
  }
  if (limits.weekly !== undefined && weekly >= limits.weekly) {
    return { ...base, ok: false, reason: `Weekly cap reached (${weekly}/${limits.weekly})` };
  }
  if (limits.monthly !== undefined && monthly >= limits.monthly) {
    return { ...base, ok: false, reason: `Monthly cap reached (${monthly}/${limits.monthly})` };
  }
  return { ...base, ok: true };
}

export function record(action: Action): void {
  const limits = resolveLimits()[action];
  if (limits.daily !== undefined) recordRateAction(action, todayKey());
  if (limits.weekly !== undefined) recordRateAction(action, isoWeekKey());
  if (limits.monthly !== undefined) recordRateAction(action, monthKey());
}

/**
 * Force a window counter to its cap. Used after a silent failure mode is
 * observed (e.g. a LinkedIn note was dropped → saturate the monthly
 * note-quota so skills stop attempting to pass notes this month). No user
 * prompt involved; this is the "no weird brakes" fallback.
 */
export function saturate(action: Action): CheckResult {
  const limits = resolveLimits()[action];
  if (limits.daily !== undefined) saturateRateAction(action, todayKey(), limits.daily);
  if (limits.weekly !== undefined) saturateRateAction(action, isoWeekKey(), limits.weekly);
  if (limits.monthly !== undefined) saturateRateAction(action, monthKey(), limits.monthly);
  return check(action);
}

function statusReport() {
  const limits = resolveLimits();
  const out: Record<string, unknown> = {
    today: todayKey(),
    week: isoWeekKey(),
    month: monthKey(),
    limits,
    today_counts: {},
    week_counts: {},
    month_counts: {},
  };
  const today: Record<string, number> = {};
  const week: Record<string, number> = {};
  const month: Record<string, number> = {};
  for (const a of VALID_ACTIONS) {
    today[a] = getRateCount(a, todayKey()).count;
    week[a] = getRateCount(a, isoWeekKey()).count;
    month[a] = getRateCount(a, monthKey()).count;
  }
  out.today_counts = today;
  out.week_counts = week;
  out.month_counts = month;
  out.history = allRateRows();
  return out;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case 'check': {
      const action = rest[0];
      if (!action) {
        console.error('Usage: rate-limiter.ts check <action>');
        process.exit(2);
      }
      assertValidAction(action);
      const r = check(action);
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
    }
    case 'record': {
      const action = rest[0];
      if (!action) {
        console.error('Usage: rate-limiter.ts record <action>');
        process.exit(2);
      }
      assertValidAction(action);
      record(action);
      console.log(JSON.stringify({ recorded: action, ...check(action) }));
      break;
    }
    case 'saturate': {
      const action = rest[0];
      if (!action) {
        console.error('Usage: rate-limiter.ts saturate <action>');
        process.exit(2);
      }
      assertValidAction(action);
      const r = saturate(action);
      console.log(JSON.stringify({ saturated: action, ...r }));
      break;
    }
    case 'reset': {
      const action = rest[0];
      const scope = (rest[1] ?? 'all') as 'day' | 'week' | 'month' | 'all';
      if (!action) {
        console.error('Usage: rate-limiter.ts reset <action> [day|week|month|all]');
        process.exit(2);
      }
      assertValidAction(action);
      const cleared: string[] = [];
      if (scope === 'day' || scope === 'all') {
        if (resetRateAction(action, todayKey()) > 0) cleared.push(todayKey());
      }
      if (scope === 'week' || scope === 'all') {
        if (resetRateAction(action, isoWeekKey()) > 0) cleared.push(isoWeekKey());
      }
      if (scope === 'month' || scope === 'all') {
        if (resetRateAction(action, monthKey()) > 0) cleared.push(monthKey());
      }
      console.log(JSON.stringify({ reset: action, scope, cleared, ...check(action) }));
      break;
    }
    case 'status': {
      console.log(JSON.stringify(statusReport(), null, 2));
      break;
    }
    case 'prune': {
      const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const removed = pruneRateRowsBefore(`day:${cutoff}`);
      console.log(JSON.stringify({ pruned: removed, cutoff: `day:${cutoff}` }));
      break;
    }
    default:
      console.error(
        'Usage: tsx src/rate-limiter.ts check <action> | record <action> | saturate <action> | reset <action> [day|week|month|all] | status | prune',
      );
      process.exit(2);
  }
}
