import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { safeEvaluate } from './page-helpers.ts';

export async function extractInbox(page: Page, limit: number): Promise<ToolResult> {
  const url = 'https://www.linkedin.com/messaging/';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 20_000 });
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    // continue
  }
  // Let SPA hydrate
  await sleep(1500);

  const scrollPasses = Math.max(1, Math.floor(limit / 10));
  for (let i = 0; i < scrollPasses; i++) {
    await safeEvaluate(
      page,
      () => {
        const scrollable = document.querySelector(
          'main [class*="msg-conversations-container"], main [data-test-conversation-list], main',
        );
        if (scrollable)
          (scrollable as HTMLElement).scrollTop = (scrollable as HTMLElement).scrollHeight;
        return true;
      },
      false,
    );
    await sleep(500);
  }

  const inboxText = await safeEvaluate(
    page,
    () => {
      const main = document.querySelector('main');
      return main ? (main as HTMLElement).innerText : '';
    },
    '',
  );

  // Capture thread IDs by clicking each conversation; tolerant of failure.
  const conversationRefs = await safeEvaluate(
    page,
    async (limitVal: number) => {
      const labels = Array.from(
        document.querySelectorAll('main label[aria-label^="Select conversation"]'),
      );
      const results: Array<{ name: string; threadId: string }> = [];
      const max = Math.min(labels.length, limitVal);
      for (let i = 0; i < max; i++) {
        try {
          const label = labels[i];
          const ariaLabel = label.getAttribute('aria-label') || '';
          const name = ariaLabel.replace(/^Select conversation with\s*/i, '').trim();
          const li = label.closest('li');
          const clickTarget =
            li?.querySelector('div[class*="listitem__link"]') ??
            li?.querySelector('a[href*="/messaging/thread/"]');
          if (!clickTarget) continue;
          (clickTarget as HTMLElement).click();
          await new Promise((r) => setTimeout(r, 300));
          const match = location.href.match(/\/messaging\/thread\/([^/?#]+)/);
          if (match) results.push({ name, threadId: match[1] });
        } catch {
          continue;
        }
      }
      return results;
    },
    [] as Array<{ name: string; threadId: string }>,
    limit,
  );

  const references: Record<string, string> = {};
  for (const conv of conversationRefs) {
    references[conv.name || conv.threadId] = `/messaging/thread/${conv.threadId}/`;
  }

  return {
    url,
    sections: { inbox: stripNoise(inboxText) },
    ...(Object.keys(references).length ? { references } : {}),
  };
}

function stripNoise(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^(Skip to|Status is|Premium|Try Premium|Saved|Sales Nav)/i.test(l))
    .join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
