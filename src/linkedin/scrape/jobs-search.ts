import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText, scrollMainToBottom, extractAnchors } from './page-helpers.ts';

const PAGE_SIZE = 25;

export type JobSearchOpts = {
  keywords: string;
  location?: string;
  maxPages?: number;
  datePosted?: string;
  jobType?: string;
  experienceLevel?: string;
  workType?: string;
  easyApply?: boolean;
  sortBy?: string;
};

export async function extractJobsSearch(page: Page, opts: JobSearchOpts): Promise<ToolResult> {
  const baseUrl = buildSearchUrl(opts);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 1, 1), 10);
  const seenIds = new Set<string>();
  const collectedTexts: string[] = [];
  const allRefs: Record<string, string> = {};

  for (let p = 0; p < maxPages; p++) {
    const url = p === 0 ? baseUrl : `${baseUrl}&start=${p * PAGE_SIZE}`;
    await gotoAndSettle(page, url, { waitForSelector: 'main' });
    await scrollMainToBottom(page, 3);
    const text = await readMainText(page);
    if (!text) break;
    collectedTexts.push(text);
    const refs = await extractAnchors(page, 'main');
    Object.assign(allRefs, refs);
    const ids = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('[data-job-id]'))) {
        const id = el.getAttribute('data-job-id');
        if (id && !out.includes(id)) out.push(id);
      }
      return out;
    });
    let added = 0;
    for (const id of ids) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        added++;
      }
    }
    if (added === 0 && p > 0) break;
    if (p < maxPages - 1) await sleep(1500);
  }

  return {
    url: baseUrl,
    sections: { search_results: collectedTexts.join('\n---page---\n') },
    job_ids: Array.from(seenIds),
    ...(Object.keys(allRefs).length ? { references: allRefs } : {}),
  };
}

function buildSearchUrl(opts: JobSearchOpts): string {
  const params = new URLSearchParams();
  params.set('keywords', opts.keywords);
  if (opts.location) params.set('location', opts.location);
  if (opts.datePosted) params.set('f_TPR', mapDatePosted(opts.datePosted));
  if (opts.jobType) params.set('f_JT', mapJobType(opts.jobType));
  if (opts.experienceLevel) params.set('f_E', mapExperienceLevel(opts.experienceLevel));
  if (opts.workType) params.set('f_WT', mapWorkType(opts.workType));
  if (opts.easyApply) params.set('f_AL', 'true');
  if (opts.sortBy === 'date') params.set('sortBy', 'DD');
  if (opts.sortBy === 'relevance') params.set('sortBy', 'R');
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function mapDatePosted(v: string): string {
  return (
    {
      past_hour: 'r3600',
      past_24_hours: 'r86400',
      past_week: 'r604800',
      past_month: 'r2592000',
    }[v] ?? ''
  );
}
function mapJobType(v: string): string {
  return ({ full_time: 'F', part_time: 'P', contract: 'C', temporary: 'T', volunteer: 'V', internship: 'I', other: 'O' }[v] ?? '');
}
function mapExperienceLevel(v: string): string {
  return ({ internship: '1', entry: '2', associate: '3', mid_senior: '4', director: '5', executive: '6' }[v] ?? '');
}
function mapWorkType(v: string): string {
  return ({ on_site: '1', remote: '2', hybrid: '3' }[v] ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
