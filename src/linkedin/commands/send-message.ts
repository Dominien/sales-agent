import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runSendMessage(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const linkedinUsername = typeof flags['linkedin-username'] === 'string' ? flags['linkedin-username'] : undefined;
  const message = typeof flags.message === 'string' ? flags.message : undefined;
  const profileUrn = typeof flags['profile-urn'] === 'string' ? flags['profile-urn'] : undefined;
  const confirmSend = flags['confirm-send'] === true || flags['confirm-send'] === 'true';
  if (!linkedinUsername) emitError('Provide --linkedin-username');
  if (!message) emitError('Provide --message');
  await runViaDaemon('send-message', { linkedinUsername, message, profileUrn, confirmSend });
}
