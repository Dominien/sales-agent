import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { BrowserContext, Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { extractInbox } from '../scrape/inbox.ts';
import { extractConversation } from '../scrape/conversation.ts';
import { extractPersonProfile } from '../scrape/profile.ts';
import { performConnect } from '../scrape/connect.ts';
import { performSendMessage } from '../scrape/compose.ts';
import { extractPeopleSearch } from '../scrape/people-search.ts';
import { extractJobsSearch, type JobSearchOpts } from '../scrape/jobs-search.ts';
import { extractCompanyProfile, extractCompanyPosts } from '../scrape/company.ts';
import { extractJob } from '../scrape/job.ts';
import { parsePersonSections, parseCompanySections } from '../scrape/sections.ts';
import { awaitLoggedIn } from '../session/auth.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'cli.ts');

let loginSpawned = false;

function autoOpenLoginBrowser(): void {
  if (loginSpawned) return;
  loginSpawned = true;
  process.stderr.write('[daemon] session invalid — opening LinkedIn login window\n');
  try {
    const child = spawn('npx', ['tsx', CLI_PATH, 'login'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    process.stderr.write('[daemon] failed to spawn login: ' + String(e) + '\n');
  }
  // Daemon self-shutdown — next user request will spawn a fresh daemon
  // with the new cookies bridged in.
  setTimeout(() => {
    process.stderr.write('[daemon] shutting down to pick up fresh session on next call\n');
    process.exit(0);
  }, 1500);
}

export type DispatchResult =
  | { kind: 'ok'; value: ToolResult; unknownSections?: string[] }
  | { kind: 'auth_required' }
  | { kind: 'rate_limited' }
  | { kind: 'error'; message: string };

let lastAuthCheck = 0;
const AUTH_TTL_MS = 5 * 60 * 1000;

async function ensureAuthed(page: Page): Promise<{ kind: 'ok' } | { kind: 'auth_required' } | { kind: 'rate_limited' }> {
  // Trust cached auth for 5 min — the daemon already navigated to /feed/ on init.
  if (Date.now() - lastAuthCheck < AUTH_TTL_MS) return { kind: 'ok' };
  // First time: just check the current page (already on linkedin.com after init).
  const url = page.url();
  if (url.startsWith('https://www.linkedin.com')) {
    if (await awaitLoggedIn(page, 5_000)) {
      lastAuthCheck = Date.now();
      return { kind: 'ok' };
    }
  }
  // Page is elsewhere or not logged in — try a fresh nav to /feed/.
  const resp = await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  if (resp && resp.status() === 429) return { kind: 'rate_limited' };
  if (!(await awaitLoggedIn(page))) {
    autoOpenLoginBrowser();
    return { kind: 'auth_required' };
  }
  lastAuthCheck = Date.now();
  return { kind: 'ok' };
}

export async function dispatch(
  ctx: BrowserContext,
  command: string,
  args: Record<string, any>,
): Promise<DispatchResult> {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const auth = await ensureAuthed(page);
  if (auth.kind !== 'ok') return auth as DispatchResult;

  try {
    switch (command) {
      case 'get-inbox': {
        const limit = clampInt(args.limit, 1, 50, 20);
        return ok(await extractInbox(page, limit));
      }
      case 'get-conversation': {
        return ok(
          await extractConversation(page, {
            linkedinUsername: args.linkedinUsername,
            threadId: args.threadId,
          }),
        );
      }
      case 'get-person-profile': {
        const { requested, unknown } = parsePersonSections(args.sections);
        const result = await extractPersonProfile(page, args.linkedinUsername, requested);
        return ok(result, unknown);
      }
      case 'connect': {
        return ok(await performConnect(page, args.linkedinUsername, args.note));
      }
      case 'send-message': {
        return ok(
          await performSendMessage(page, args.linkedinUsername, args.message, {
            confirmSend: !!args.confirmSend,
            profileUrn: args.profileUrn,
          }),
        );
      }
      case 'search-people': {
        return ok(
          await extractPeopleSearch(page, { keywords: args.keywords, location: args.location }),
        );
      }
      case 'search-jobs': {
        const opts: JobSearchOpts = {
          keywords: args.keywords,
          location: args.location,
          maxPages: args.maxPages,
          datePosted: args.datePosted,
          jobType: args.jobType,
          experienceLevel: args.experienceLevel,
          workType: args.workType,
          easyApply: !!args.easyApply,
          sortBy: args.sortBy,
        };
        return ok(await extractJobsSearch(page, opts));
      }
      case 'get-company-profile': {
        const { requested, unknown } = parseCompanySections(args.sections);
        const result = await extractCompanyProfile(page, args.companyName, requested);
        return ok(result, unknown);
      }
      case 'get-company-posts': {
        return ok(await extractCompanyPosts(page, args.companyName));
      }
      case 'get-job-details': {
        return ok(await extractJob(page, args.jobId));
      }
      case 'check': {
        return ok({ url: page.url(), sections: { check: 'authed' }, status: 'authed' } as ToolResult);
      }
      default:
        return { kind: 'error', message: `Unknown command: ${command}` };
    }
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

function ok(value: ToolResult, unknownSections?: string[]): DispatchResult {
  if (unknownSections && unknownSections.length) value.unknown_sections = unknownSections;
  return { kind: 'ok', value };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
