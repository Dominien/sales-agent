import { emitError, parseFlags } from '../io.ts';
import { runViaDaemon } from '../runner.ts';

export async function runSearchJobs(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const keywords = typeof flags.keywords === 'string' ? flags.keywords : undefined;
  if (!keywords) emitError('Provide --keywords');
  await runViaDaemon('search-jobs', {
    keywords,
    location: typeof flags.location === 'string' ? flags.location : undefined,
    maxPages: typeof flags['max-pages'] === 'string' ? parseInt(flags['max-pages'], 10) : 1,
    datePosted: typeof flags['date-posted'] === 'string' ? flags['date-posted'] : undefined,
    jobType: typeof flags['job-type'] === 'string' ? flags['job-type'] : undefined,
    experienceLevel: typeof flags['experience-level'] === 'string' ? flags['experience-level'] : undefined,
    workType: typeof flags['work-type'] === 'string' ? flags['work-type'] : undefined,
    easyApply: flags['easy-apply'] === true || flags['easy-apply'] === 'true',
    sortBy: typeof flags['sort-by'] === 'string' ? flags['sort-by'] : undefined,
  });
}
