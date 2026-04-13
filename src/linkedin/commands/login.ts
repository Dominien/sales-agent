import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openContext } from '../browser/launch.ts';
import { warmup } from '../browser/warmup.ts';
import { waitForManualLogin } from '../session/auth.ts';
import { writeCookiesFromContext } from '../session/cookies.ts';
import { paths } from '../session/paths.ts';
import { emit, emitError, log } from '../io.ts';

export async function runLogin(): Promise<void> {
  const ctx = await openContext({ headless: false, slowMo: 40 });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await warmup(page);
    log('navigating to linkedin.com/login');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    await waitForManualLogin(page);
    const cookies = await writeCookiesFromContext(ctx);
    log(`wrote ${cookies.length} cookies → ${paths.cookies}`);
    writeFileSync(
      paths.sourceStateTs,
      JSON.stringify(
        {
          version: 1,
          login_generation: randomUUID(),
          created_at: new Date().toISOString(),
          profile_path: paths.profile,
          cookies_path: paths.cookies,
          source_runtime_id: `${process.platform}-${process.arch}-host`,
        },
        null,
        2,
      ),
      'utf-8',
    );
    log(`wrote source-state-ts → ${paths.sourceStateTs}`);
    emit({ url: 'https://www.linkedin.com/feed/', sections: { login: 'success' }, status: 'logged_in' });
  } catch (e) {
    emitError(e);
  } finally {
    await ctx.close().catch(() => {});
  }
}
