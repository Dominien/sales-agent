import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runConnect(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const linkedinUsername = typeof flags['linkedin-username'] === 'string' ? flags['linkedin-username'] : undefined;
  const note = typeof flags.note === 'string' ? flags.note : undefined;
  if (!linkedinUsername) emitError('Provide --linkedin-username');
  if (note && note.length > 300) emitError(`Note is ${note.length} chars; LinkedIn limit is 300.`);
  await runViaDaemon('connect', { linkedinUsername, note });
}
