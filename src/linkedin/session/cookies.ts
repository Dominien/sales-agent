import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import type { BrowserContext } from 'rebrowser-playwright';
import { paths } from './paths.ts';

export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export function readCookies(file: string = paths.cookies): Cookie[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export async function writeCookiesFromContext(
  ctx: BrowserContext,
  file: string = paths.cookies,
): Promise<Cookie[]> {
  const all = await ctx.cookies();
  const filtered = all
    .filter((c) => c.domain.endsWith('linkedin.com'))
    .map(normalizeDomain);
  writeFileSync(file, JSON.stringify(filtered, null, 2), 'utf-8');
  try {
    chmodSync(file, 0o600);
  } catch {
    // ignore
  }
  return filtered as Cookie[];
}

function normalizeDomain<T extends { domain: string }>(c: T): T {
  if (c.domain === '.www.linkedin.com') {
    return { ...c, domain: '.linkedin.com' };
  }
  return c;
}
