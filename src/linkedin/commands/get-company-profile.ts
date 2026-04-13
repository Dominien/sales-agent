import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runGetCompanyProfile(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const companyName = typeof flags['company-name'] === 'string' ? flags['company-name'] : undefined;
  const sections = typeof flags.sections === 'string' ? flags.sections : 'about';
  if (!companyName) emitError('Provide --company-name');
  await runViaDaemon('get-company-profile', { companyName, sections });
}
