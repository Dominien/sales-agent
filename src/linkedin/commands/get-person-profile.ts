import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runGetPersonProfile(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const linkedinUsername = typeof flags['linkedin-username'] === 'string' ? flags['linkedin-username'] : undefined;
  const sections = typeof flags.sections === 'string' ? flags.sections : 'experience,education,posts';
  if (!linkedinUsername) emitError('Provide --linkedin-username');
  await runViaDaemon('get-person-profile', { linkedinUsername, sections });
}
