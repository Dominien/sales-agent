import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText, scrollMainToBottom, extractAnchors } from './page-helpers.ts';

export type PeopleSearchOpts = {
  keywords: string;
  location?: string;
};

export async function extractPeopleSearch(page: Page, opts: PeopleSearchOpts): Promise<ToolResult> {
  const params = new URLSearchParams();
  params.set('keywords', opts.keywords);
  if (opts.location) params.set('origin', 'GLOBAL_SEARCH_HEADER');
  const url = `https://www.linkedin.com/search/results/people/?${params.toString()}`;
  await gotoAndSettle(page, url, { waitForSelector: 'main' });
  await scrollMainToBottom(page, 3);
  const text = await readMainText(page);
  const refs = await extractAnchors(page, 'main');
  // Filter refs to /in/ profile paths only
  const profileRefs: Record<string, string> = {};
  for (const [name, href] of Object.entries(refs)) {
    if (/\/in\/[^/?#]+/.test(href)) profileRefs[name] = href;
  }
  return {
    url,
    sections: { search_results: text },
    ...(Object.keys(profileRefs).length ? { references: profileRefs } : {}),
  };
}
