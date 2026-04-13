import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runGetJobDetails(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const jobId = typeof flags['job-id'] === 'string' ? flags['job-id'] : undefined;
  if (!jobId) emitError('Provide --job-id');
  await runViaDaemon('get-job-details', { jobId });
}
