import { chromium, type BrowserContext } from 'rebrowser-playwright';
import { ensureProfileDir, paths } from '../session/paths.ts';
import { readCookies } from '../session/cookies.ts';

export type LaunchOptions = {
  headless?: boolean;
  slowMo?: number;
  /** When true (default), seed cookies from cookies.json into the context. */
  bridgeCookies?: boolean;
};

export async function openContext(opts: LaunchOptions = {}): Promise<BrowserContext> {
  ensureProfileDir();
  const context = await chromium.launchPersistentContext(paths.profile, {
    headless: opts.headless ?? true,
    slowMo: opts.slowMo ?? 0,
    viewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
    ],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/136.0.0.0 Safari/537.36',
  });
  context.setDefaultTimeout(30_000);

  if (opts.bridgeCookies !== false) {
    await seedCookies(context);
  }
  return context;
}

async function seedCookies(ctx: BrowserContext): Promise<void> {
  const cookies = readCookies();
  if (cookies.length === 0) return;
  const normalized = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expires ?? -1,
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? false,
    sameSite: (c.sameSite ?? 'Lax') as 'Strict' | 'Lax' | 'None',
  }));
  await ctx.addCookies(normalized);
}

export async function withContext<T>(
  opts: LaunchOptions,
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await openContext(opts);
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}
