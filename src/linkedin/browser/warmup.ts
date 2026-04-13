import type { Page } from 'rebrowser-playwright';
import { log } from '../io.ts';

const SITES = ['https://www.google.com', 'https://www.wikipedia.org', 'https://www.github.com'];

export async function warmup(page: Page): Promise<void> {
  log('warming up browser...');
  let failures = 0;
  for (const site of SITES) {
    try {
      await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      failures++;
    }
  }
  if (failures === SITES.length) {
    log('warm-up failed: no warm-up site reachable');
  }
}
