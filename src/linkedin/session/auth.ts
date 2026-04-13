import type { Page } from 'rebrowser-playwright';
import { log } from '../io.ts';

const AUTH_BLOCKER_PATTERNS = [
  '/login',
  '/authwall',
  '/checkpoint',
  '/challenge',
  '/uas/login',
  '/uas/consumer-email-challenge',
];

const AUTHED_ONLY_PAGES = ['/feed', '/mynetwork', '/messaging', '/notifications'];

const NAV_SELECTOR_OLD = '.global-nav__primary-link, [data-control-name="nav.settings"]';
const NAV_SELECTOR_NEW = 'nav a[href*="/feed"], nav button:has-text("Home"), nav a[href*="/mynetwork"]';

const REMEMBER_ME_CONTAINER = '#rememberme-div';
const REMEMBER_ME_BUTTON = '#rememberme-div button';

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (isAuthBlockerUrl(url)) return false;

    const oldCount = await page.locator(NAV_SELECTOR_OLD).count();
    const newCount = await page.locator(NAV_SELECTOR_NEW).count();
    const hasNav = oldCount > 0 || newCount > 0;

    const isAuthedPage = AUTHED_ONLY_PAGES.some((p) => url.includes(p));
    if (!isAuthedPage) return hasNav;
    if (hasNav) return true;

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    return typeof bodyText === 'string' && bodyText.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Block until the page reports a logged-in state or `timeoutMs` elapses.
 * Useful right after navigation when SPA hydration trails the load event.
 */
export async function awaitLoggedIn(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) return true;
    await sleep(500);
  }
  return false;
}

export async function resolveRememberMePrompt(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector(REMEMBER_ME_CONTAINER, { timeout: 3000 });
  } catch {
    return false;
  }
  const target = page.locator(REMEMBER_ME_BUTTON).first();
  if ((await target.count()) === 0) return false;
  try {
    await target.waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    return false;
  }
  log('clicking saved-account chooser to resume session');
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 3000 });
  } catch {
    // ignore
  }
  try {
    await target.click({ timeout: 5000 });
  } catch {
    await target.click({ timeout: 5000, force: true });
  }
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
  } catch {
    // ignore
  }
  await sleep(1000);
  return true;
}

export async function waitForManualLogin(page: Page, timeoutMs = 300_000): Promise<void> {
  log('Complete login in the browser window. Waiting up to 5 minutes...');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await resolveRememberMePrompt(page)) continue;
    if (await isLoggedIn(page)) {
      log('login detected');
      return;
    }
    process.stderr.write('.');
    await sleep(2000);
  }
  throw new Error('Manual login timed out after 5 minutes.');
}

function isAuthBlockerUrl(url: string): boolean {
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    return false;
  }
  if (AUTH_BLOCKER_PATTERNS.includes(path)) return true;
  return AUTH_BLOCKER_PATTERNS.some((p) => path === `${p}/` || path.startsWith(`${p}/`));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
