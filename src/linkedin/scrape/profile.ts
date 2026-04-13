import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText, scrollMainToBottom, extractAnchors } from './page-helpers.ts';
import { PERSON_SECTIONS } from './sections.ts';

const NAV_DELAY_MS = 1500;

export async function extractPersonProfile(
  page: Page,
  username: string,
  requested: string[],
): Promise<ToolResult> {
  const base = `https://www.linkedin.com/in/${username}`;
  const sections: Record<string, string> = {};
  const references: Record<string, string> = {};
  const sectionErrors: Record<string, string> = {};
  let profileUrn: string | undefined;

  for (let i = 0; i < requested.length; i++) {
    const name = requested[i];
    const meta = PERSON_SECTIONS[name];
    if (!meta) continue;
    if (i > 0) await sleep(NAV_DELAY_MS);
    const url = base + meta.suffix;
    try {
      await gotoAndSettle(page, url, { waitForSelector: 'main' });
      await scrollMainToBottom(page, 2);
      const text = await readMainText(page);
      if (text) sections[name] = text;
      else sectionErrors[name] = 'empty content';
      const refs = await extractAnchors(page, 'main');
      Object.assign(references, refs);
      if (name === 'main_profile' && !profileUrn) {
        profileUrn = await readProfileUrn(page);
      }
    } catch (e) {
      sectionErrors[name] = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    url: `${base}/`,
    sections,
    ...(profileUrn ? { profile_urn: profileUrn } : {}),
    ...(Object.keys(references).length ? { references } : {}),
    ...(Object.keys(sectionErrors).length ? { section_errors: sectionErrors } : {}),
  };
}

async function readProfileUrn(page: Page): Promise<string | undefined> {
  const urn = await page
    .evaluate(() => {
      const a = document.querySelector('a[href*="/messaging/compose/?recipient="]') as HTMLAnchorElement | null;
      if (!a) return null;
      const m = a.href.match(/recipient=(ACoAA[A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    })
    .catch(() => null);
  return urn ?? undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
