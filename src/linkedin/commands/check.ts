import { runViaDaemon } from '../runner.ts';

export async function runCheck(): Promise<void> {
  await runViaDaemon('check', {});
}
