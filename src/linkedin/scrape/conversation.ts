import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText, extractAnchors } from './page-helpers.ts';

export async function extractConversation(
  page: Page,
  opts: { linkedinUsername?: string; threadId?: string },
): Promise<ToolResult> {
  let url: string;
  if (opts.threadId) {
    url = `https://www.linkedin.com/messaging/thread/${opts.threadId}/`;
    await gotoAndSettle(page, url, { waitForSelector: 'main' });
  } else if (opts.linkedinUsername) {
    url = `https://www.linkedin.com/in/${opts.linkedinUsername}/`;
    await gotoAndSettle(page, url, { waitForSelector: 'main' });
    const opened = await openMessageFromProfile(page);
    if (!opened) {
      return {
        url: page.url(),
        sections: { conversation: '' },
        status: 'message_unavailable',
        message: 'Could not open message thread from profile.',
      };
    }
    url = page.url();
  } else {
    throw new Error('Provide --linkedin-username or --thread-id');
  }

  // Scroll to top to load older messages
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const list = document.querySelector('main [class*="msg-s-message-list"], main [data-test-message-list]');
      if (list) (list as HTMLElement).scrollTop = 0;
    });
    await sleep(400);
  }

  const conversation = await readMainText(page);
  const references = await extractAnchors(page, 'main');

  return {
    url: page.url(),
    sections: { conversation },
    ...(Object.keys(references).length ? { references } : {}),
  };
}

async function openMessageFromProfile(page: Page): Promise<boolean> {
  const btn = page.locator(
    'button[aria-label*="Message"], button:has-text("Message"), a[href*="/messaging/compose"]',
  );
  if ((await btn.count()) === 0) return false;
  try {
    await btn.first().click({ timeout: 5000 });
  } catch {
    return false;
  }
  try {
    await page.waitForSelector('main', { timeout: 10_000 });
  } catch {
    // continue
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
