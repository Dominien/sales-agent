import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runSearchPeople(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const keywords = typeof flags.keywords === 'string' ? flags.keywords : undefined;
  const location = typeof flags.location === 'string' ? flags.location : undefined;
  if (!keywords) emitError('Provide --keywords');
  await runViaDaemon('search-people', { keywords, location });
}
