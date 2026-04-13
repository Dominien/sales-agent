import type { Page, BrowserContext } from 'rebrowser-playwright';

export async function gotoAndSettle(
  page: Page,
  url: string,
  opts: { waitForSelector?: string; networkIdleMs?: number } = {},
): Promise<{ status: number | null }> {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (opts.waitForSelector) {
    try {
      await page.waitForSelector(opts.waitForSelector, { timeout: 20_000 });
    } catch {
      // continue
    }
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: opts.networkIdleMs ?? 8000 });
  } catch {
    // continue
  }
  return { status: resp?.status() ?? null };
}

/**
 * Retry an evaluate call when LinkedIn's SPA destroys the execution context
 * mid-navigation. Up to 3 attempts with a small settle pause between each.
 */
export async function safeEvaluate<T>(
  page: Page,
  fn: () => T | Promise<T>,
  fallback: T,
): Promise<T>;
export async function safeEvaluate<T, A>(
  page: Page,
  fn: (arg: A) => T | Promise<T>,
  fallback: T,
  arg: A,
): Promise<T>;
export async function safeEvaluate<T, A>(
  page: Page,
  fn: (arg?: A) => T | Promise<T>,
  fallback: T,
  arg?: A,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (arg === undefined) return await page.evaluate(fn as any);
      return await page.evaluate(fn as any, arg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/context was destroyed|Execution context|Target closed/.test(msg)) throw e;
      await sleep(800);
    }
  }
  return fallback;
}

export async function readMainText(page: Page): Promise<string> {
  const text = await safeEvaluate(
    page,
    () => {
      const main = document.querySelector('main');
      return main ? (main as HTMLElement).innerText : '';
    },
    '',
  );
  return stripNoise(text || '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function readSelectorText(page: Page, selector: string): Promise<string> {
  const text = await safeEvaluate(
    page,
    (sel: string) => {
      const el = document.querySelector(sel);
      return el ? (el as HTMLElement).innerText : '';
    },
    '',
    selector,
  );
  return stripNoise(text || '');
}

export function stripNoise(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter(
      (l) =>
        !/^(Skip to|Status is|Try Premium|Premium\s*$|Saved\s*$|See all|Activate to view|Visible to anyone)/i.test(
          l,
        ),
    )
    .join('\n');
}

export async function scrollMainToBottom(page: Page, passes = 3): Promise<void> {
  for (let i = 0; i < passes; i++) {
    await safeEvaluate(
      page,
      () => {
        const target =
          document.querySelector('main [class*="scaffold-finite-scroll"]') ??
          document.querySelector('main');
        if (target) (target as HTMLElement).scrollTop = (target as HTMLElement).scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        return true;
      },
      false,
    );
    await new Promise((r) => setTimeout(r, 600));
  }
}

export async function extractAnchors(
  page: Page,
  rootSelector: string,
): Promise<Record<string, string>> {
  const out = await safeEvaluate(
    page,
    (sel: string) => {
      const root = document.querySelector(sel);
      if (!root) return {} as Record<string, string>;
      const refs: Record<string, string> = {};
      for (const a of Array.from(root.querySelectorAll('a[href]'))) {
        const href = (a as HTMLAnchorElement).getAttribute('href') || '';
        const text = ((a as HTMLAnchorElement).innerText || '').trim();
        if (!href || !text || href.startsWith('#')) continue;
        const norm = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
        if (!refs[text]) refs[text] = norm;
      }
      return refs;
    },
    {} as Record<string, string>,
    rootSelector,
  );
  return out || {};
}

export async function withAuthedPage<T>(
  ctx: BrowserContext,
  fn: (page: Page) => Promise<T>,
): Promise<{ kind: 'rate_limited' } | { kind: 'auth_required' } | { kind: 'ok'; value: T }> {
  const { warmup } = await import('../browser/warmup.ts');
  const { awaitLoggedIn } = await import('../session/auth.ts');
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await warmup(page);
  const resp = await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  if (resp && resp.status() === 429) return { kind: 'rate_limited' };
  if (!(await awaitLoggedIn(page))) return { kind: 'auth_required' };
  const value = await fn(page);
  return { kind: 'ok', value };
}
