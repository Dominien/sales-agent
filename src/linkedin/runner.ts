import { callDaemon } from './daemon/client.ts';
import { emit, emitError } from './io.ts';
import type { CommandResult } from './types.ts';

/**
 * Single entry point every scrape command uses.
 * Routes the request through the daemon (auto-spawning it if not running).
 */
export async function runViaDaemon(command: string, args: Record<string, any>): Promise<void> {
  try {
    const resp = await callDaemon(command, args);
    if (resp.ok) {
      emit(resp.result as CommandResult);
    }
    if (resp.error === 'auth_required') {
      emit({
        status: 'auth_required',
        message:
          'Session expired. A login browser window has been opened — sign in there, then retry this command.',
      });
    }
    if (resp.error === 'rate_limited') {
      emit({
        status: 'error',
        error: 'rate_limited',
        detail: resp.detail ?? 'LinkedIn returned 429.',
      });
    }
    emitError(resp.error, resp.detail);
  } catch (e) {
    emitError(e);
  }
}
