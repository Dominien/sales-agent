import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, openSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { daemonPaths } from './paths.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'cli.ts');

export type DaemonResponse =
  | { ok: true; result: any }
  | { ok: false; error: string; detail?: string };

export async function callDaemon(command: string, args: Record<string, any>): Promise<DaemonResponse> {
  await ensureDaemon();
  return sendRequest({ command, args });
}

async function sendRequest(payload: { command: string; args?: Record<string, any> }): Promise<DaemonResponse> {
  return new Promise((resolveP, rejectP) => {
    const conn = net.createConnection(daemonPaths.socket);
    let buf = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { conn.destroy(); } catch {}
        rejectP(new Error('daemon request timed out after 120s'));
      }
    }, 120_000);
    conn.setEncoding('utf-8');
    conn.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1 && !resolved) {
        const line = buf.slice(0, nl);
        clearTimeout(timeout);
        resolved = true;
        try {
          resolveP(JSON.parse(line));
        } catch (e) {
          rejectP(e instanceof Error ? e : new Error(String(e)));
        } finally {
          try { conn.destroy(); } catch {}
        }
      }
    });
    conn.on('error', (e) => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        rejectP(e);
      }
    });
    conn.on('connect', () => {
      conn.write(JSON.stringify(payload) + '\n');
    });
  });
}

async function ensureDaemon(): Promise<void> {
  if (await pingDaemon()) return;
  if (existsSync(daemonPaths.socket)) {
    try { unlinkSync(daemonPaths.socket); } catch {}
  }
  if (existsSync(daemonPaths.meta)) {
    try { unlinkSync(daemonPaths.meta); } catch {}
  }
  spawnDaemon();
  // Wait up to 60s for the daemon to come up
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await pingDaemon()) return;
    await sleep(500);
  }
  throw new Error('daemon failed to start within 60s — check ' + daemonPaths.log);
}

async function pingDaemon(): Promise<boolean> {
  if (!existsSync(daemonPaths.socket)) return false;
  try {
    const resp = await sendRequest({ command: 'ping' });
    return resp.ok;
  } catch {
    return false;
  }
}

function spawnDaemon(): void {
  const out = openSync(daemonPaths.log, 'a');
  const err = openSync(daemonPaths.log, 'a');
  const child = spawn('npx', ['tsx', CLI_PATH, 'daemon', '--foreground'], {
    detached: true,
    stdio: ['ignore', out, err],
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function readDaemonMeta(): { pid: number; socket: string; started_at: string } | null {
  if (!existsSync(daemonPaths.meta)) return null;
  try {
    return JSON.parse(readFileSync(daemonPaths.meta, 'utf-8'));
  } catch {
    return null;
  }
}
