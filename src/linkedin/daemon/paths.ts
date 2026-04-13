import { homedir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../session/paths.ts';

export const daemonPaths = {
  socket: join(paths.root, 'daemon.sock'),
  meta: join(paths.root, 'daemon.json'),
  log: join(paths.root, 'daemon.log'),
};

export type DaemonMeta = {
  pid: number;
  socket: string;
  started_at: string;
  cli_path: string;
};

void homedir; // keep import for parity if paths.root changes
