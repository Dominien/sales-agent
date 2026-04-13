import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText, extractAnchors } from './page-helpers.ts';

export async function extractJob(page: Page, jobId: string): Promise<ToolResult> {
  const url = `https://www.linkedin.com/jobs/view/${jobId}/`;
  await gotoAndSettle(page, url, { waitForSelector: 'main' });
  // Some job pages have "See more" — try to expand the description
  await page
    .locator('button:has-text("See more"), button[aria-label*="see more"]')
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  const text = await readMainText(page);
  const references = await extractAnchors(page, 'main');
  return {
    url,
    sections: { job: text },
    ...(Object.keys(references).length ? { references } : {}),
  };
}
