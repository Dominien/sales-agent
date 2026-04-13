import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runGetCompanyPosts(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const companyName = typeof flags['company-name'] === 'string' ? flags['company-name'] : undefined;
  if (!companyName) emitError('Provide --company-name');
  await runViaDaemon('get-company-posts', { companyName });
}
