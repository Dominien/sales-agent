import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';

const ROOT = join(homedir(), '.linkedin-mcp');

/**
 * The TS profile lives in its own dir to avoid Chromium "pickle version"
 * mismatches with patchright (which ships a newer Chromium). Cookies file
 * stays in the shared root so a single login serves both servers.
 */
export const paths = {
  root: ROOT,
  profile: join(ROOT, 'profile-ts'),
  cookies: join(ROOT, 'cookies.json'),
  sourceState: join(ROOT, 'source-state.json'),
  sourceStateTs: join(ROOT, 'source-state-ts.json'),
};

export function ensureRoot(): void {
  mkdirSync(paths.root, { recursive: true });
  try {
    chmodSync(paths.root, 0o700);
  } catch {
    // Windows/no-op
  }
}

export function ensureProfileDir(): void {
  ensureRoot();
  mkdirSync(paths.profile, { recursive: true });
  try {
    chmodSync(paths.profile, 0o700);
  } catch {
    // ignore
  }
}
