import { parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runGetInbox(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const limit = clampInt(flags.limit, 1, 50, 20);
  await runViaDaemon('get-inbox', { limit });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
