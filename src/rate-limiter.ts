#!/usr/bin/env node
/**
 * Per-channel rate limiter. Mandatory check before every outbound action.
 *
 * Actions recognized:
 *   - email_draft        (daily cap only)
 *   - linkedin_connect   (daily + weekly)
 *   - linkedin_message   (daily)
 *
 * Limits come from agent.config.json → rate_limits. If the config can't be
 * loaded (e.g., running during init), hard defaults are used.
 *
 * Usage:
 *   rate-limiter.ts check  <action>   → exit 0 = ok, exit 1 = blocked
 *   rate-limiter.ts record <action>   → increment counter
 *   rate-limiter.ts status
 *   rate-limiter.ts prune
 */

import { getRateCount, recordRateAction, allRateRows, pruneRateRowsBefore } from './db.ts';
import { loadConfig, ConfigError } from './config.ts';

export type Action = 'email_draft' | 'linkedin_connect' | 'linkedin_message';
const VALID_ACTIONS: Action[] = ['email_draft', 'linkedin_connect', 'linkedin_message'];

const HARD_DEFAULTS: Record<Action, { daily: number; weekly?: number }> = {
  email_draft: { daily: 200 },
  linkedin_connect: { daily: 20, weekly: 80 },
  linkedin_message: { daily: 40 },
};

function resolveLimits(): Record<Action, { daily: number; weekly?: number }> {
  try {
    const cfg = loadConfig();
    return {
      email_draft: cfg.rate_limits.email_draft ?? HARD_DEFAULTS.email_draft,
      linkedin_connect: cfg.rate_limits.linkedin_connect ?? HARD_DEFAULTS.linkedin_connect,
      linkedin_message: cfg.rate_limits.linkedin_message ?? HARD_DEFAULTS.linkedin_message,
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
  limit_daily: number;
  limit_weekly: number | null;
}

export function check(action: Action): CheckResult {
  const limits = resolveLimits()[action];
  const daily = getRateCount(action, todayKey()).count;
  const weekly = getRateCount(action, isoWeekKey()).count;
  if (daily >= limits.daily) {
    return {
      ok: false,
      reason: `Daily cap reached (${daily}/${limits.daily})`,
      daily,
      weekly,
      limit_daily: limits.daily,
      limit_weekly: limits.weekly ?? null,
    };
  }
  if (limits.weekly && weekly >= limits.weekly) {
    return {
      ok: false,
      reason: `Weekly cap reached (${weekly}/${limits.weekly})`,
      daily,
      weekly,
      limit_daily: limits.daily,
      limit_weekly: limits.weekly,
    };
  }
  return {
    ok: true,
    daily,
    weekly,
    limit_daily: limits.daily,
    limit_weekly: limits.weekly ?? null,
  };
}

export function record(action: Action): void {
  recordRateAction(action, todayKey());
  if (resolveLimits()[action].weekly) recordRateAction(action, isoWeekKey());
}

function statusReport() {
  const limits = resolveLimits();
  const out: Record<string, unknown> = {
    today: todayKey(),
    week: isoWeekKey(),
    limits,
    today_counts: {},
    week_counts: {},
  };
  const today: Record<string, number> = {};
  const week: Record<string, number> = {};
  for (const a of VALID_ACTIONS) {
    today[a] = getRateCount(a, todayKey()).count;
    week[a] = getRateCount(a, isoWeekKey()).count;
  }
  out.today_counts = today;
  out.week_counts = week;
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
      console.error('Usage: tsx src/rate-limiter.ts check <action> | record <action> | status | prune');
      process.exit(2);
  }
}
