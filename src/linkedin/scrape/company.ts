import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText, scrollMainToBottom, extractAnchors } from './page-helpers.ts';
import { COMPANY_SECTIONS } from './sections.ts';

const NAV_DELAY_MS = 1200;

export async function extractCompanyProfile(
  page: Page,
  companyName: string,
  requested: string[],
): Promise<ToolResult> {
  const base = `https://www.linkedin.com/company/${companyName}`;
  const sections: Record<string, string> = {};
  const references: Record<string, string> = {};
  const sectionErrors: Record<string, string> = {};

  for (let i = 0; i < requested.length; i++) {
    const name = requested[i];
    const meta = COMPANY_SECTIONS[name];
    if (!meta) continue;
    if (i > 0) await sleep(NAV_DELAY_MS);
    const url = base + meta.suffix;
    try {
      await gotoAndSettle(page, url, { waitForSelector: 'main' });
      await scrollMainToBottom(page, 2);
      const text = await readMainText(page);
      if (text) sections[name] = text;
      else sectionErrors[name] = 'empty content';
      Object.assign(references, await extractAnchors(page, 'main'));
    } catch (e) {
      sectionErrors[name] = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    url: `${base}/`,
    sections,
    ...(Object.keys(references).length ? { references } : {}),
    ...(Object.keys(sectionErrors).length ? { section_errors: sectionErrors } : {}),
  };
}

export async function extractCompanyPosts(page: Page, companyName: string): Promise<ToolResult> {
  const url = `https://www.linkedin.com/company/${companyName}/posts/`;
  await gotoAndSettle(page, url, { waitForSelector: 'main' });
  await scrollMainToBottom(page, 4);
  const posts = await readMainText(page);
  const references = await extractAnchors(page, 'main');
  return {
    url,
    sections: { posts },
    ...(Object.keys(references).length ? { references } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
