import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runGetConversation(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const linkedinUsername = typeof flags['linkedin-username'] === 'string' ? flags['linkedin-username'] : undefined;
  const threadId = typeof flags['thread-id'] === 'string' ? flags['thread-id'] : undefined;
  if (!linkedinUsername && !threadId) {
    emitError('Provide --linkedin-username or --thread-id');
  }
  await runViaDaemon('get-conversation', { linkedinUsername, threadId });
}
