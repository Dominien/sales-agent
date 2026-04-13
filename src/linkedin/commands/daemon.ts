import { existsSync, unlinkSync } from 'node:fs';
import { daemonPaths } from '../daemon/paths.ts';
import { callDaemon, readDaemonMeta } from '../daemon/client.ts';
import { emit, emitError, log } from '../io.ts';

export async function runDaemon(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === 'start' || sub === '--foreground' || sub === undefined) {
    // Run the daemon process in this Node instance (foreground).
    await import('../daemon/server.ts');
    return;
  }
  if (sub === 'stop') {
    await stopAndEmit();
    return;
  }
  if (sub === 'status') {
    await status();
    return;
  }
  if (sub === 'restart') {
    await stopQuiet();
    await sleep(500);
    await import('../daemon/server.ts');
    return;
  }
  emitError(`Unknown daemon subcommand: ${sub}. Use start | stop | status | restart.`);
}

async function stopQuiet(): Promise<void> {
  const meta = readDaemonMeta();
  if (!meta) {
    cleanupArtifacts();
    return;
  }
  try {
    await callDaemonShutdown();
  } catch {
    try { process.kill(meta.pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  cleanupArtifacts();
  log(`stopped pid ${meta.pid}`);
}

async function stopAndEmit(): Promise<void> {
  const meta = readDaemonMeta();
  if (!meta) {
    log('no daemon running');
    cleanupArtifacts();
    emit({ url: '', sections: { daemon: 'not_running' }, status: 'stopped' });
  }
  await stopQuiet();
  emit({ url: '', sections: { daemon: 'stopped' }, status: 'stopped' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function status(): Promise<void> {
  const meta = readDaemonMeta();
  if (!meta) {
    emit({ url: '', sections: { daemon: 'not_running' }, status: 'not_running' });
  }
  try {
    const resp = await callDaemon('ping', {});
    if (resp.ok) {
      emit({
        url: '',
        sections: {
          daemon: 'running',
          pid: String(meta!.pid),
          socket: meta!.socket,
          started_at: meta!.started_at,
        },
        status: 'running',
      });
    }
    emit({ url: '', sections: { daemon: 'unreachable' }, status: 'unreachable' });
  } catch {
    emit({ url: '', sections: { daemon: 'unreachable' }, status: 'unreachable' });
  }
}

async function callDaemonShutdown(): Promise<void> {
  await callDaemon('shutdown', {});
}

function cleanupArtifacts(): void {
  for (const p of [daemonPaths.socket, daemonPaths.meta]) {
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
}
