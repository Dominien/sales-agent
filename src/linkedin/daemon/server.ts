import net from 'node:net';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import type { BrowserContext } from 'rebrowser-playwright';
import { openContext } from '../browser/launch.ts';
import { warmup } from '../browser/warmup.ts';
import { ensureRoot } from '../session/paths.ts';
import { daemonPaths, type DaemonMeta } from './paths.ts';
import { dispatch } from './dispatch.ts';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

let context: BrowserContext | null = null;
let lastActivity = Date.now();
let queue: Array<() => Promise<void>> = [];
let busy = false;
let shuttingDown = false;

function log(...args: unknown[]) {
  process.stderr.write('[daemon] ' + args.map(String).join(' ') + '\n');
}

async function init(): Promise<void> {
  ensureRoot();
  // Clean up stale socket
  if (existsSync(daemonPaths.socket)) {
    try {
      unlinkSync(daemonPaths.socket);
    } catch {
      // ignore
    }
  }
  const headful = process.env.LINKEDIN_HEADFUL === '1';
  log(`opening browser context (${headful ? 'HEADFUL' : 'headless'})...`);
  context = await openContext({ headless: !headful, slowMo: headful ? 150 : 0 });
  const page = context.pages()[0] ?? (await context.newPage());
  await warmup(page);
  log('navigating to /feed/ to establish session...');
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (e) {
    log('initial nav failed:', String(e));
  }
  log('ready');
}

function cleanup(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down...');
  try {
    server.close();
  } catch {
    // ignore
  }
  try {
    if (existsSync(daemonPaths.socket)) unlinkSync(daemonPaths.socket);
  } catch {
    // ignore
  }
  try {
    if (existsSync(daemonPaths.meta)) unlinkSync(daemonPaths.meta);
  } catch {
    // ignore
  }
  context?.close().catch(() => {});
}

const server = net.createServer((conn) => {
  let buf = '';
  conn.setEncoding('utf-8');
  conn.on('data', (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      enqueue(line, conn);
      nl = buf.indexOf('\n');
    }
  });
  conn.on('error', () => {
    // ignore broken pipe
  });
});

function enqueue(line: string, conn: net.Socket): void {
  queue.push(async () => {
    let payload: { command: string; args?: Record<string, unknown> };
    try {
      payload = JSON.parse(line);
    } catch {
      reply(conn, { ok: false, error: 'invalid json' });
      return;
    }
    if (payload.command === 'ping') {
      reply(conn, { ok: true, result: { pong: true } });
      return;
    }
    if (payload.command === 'shutdown') {
      reply(conn, { ok: true, result: { shutdown: true } });
      cleanup();
      setTimeout(() => process.exit(0), 100);
      return;
    }
    if (!context) {
      reply(conn, { ok: false, error: 'browser not ready' });
      return;
    }
    lastActivity = Date.now();
    const result = await dispatch(context, payload.command, payload.args ?? {});
    if (result.kind === 'ok') reply(conn, { ok: true, result: result.value });
    else if (result.kind === 'auth_required')
      reply(conn, {
        ok: false,
        error: 'auth_required',
        detail: 'Run: npx tsx src/linkedin/cli.ts login',
      });
    else if (result.kind === 'rate_limited')
      reply(conn, { ok: false, error: 'rate_limited', detail: 'LinkedIn returned 429.' });
    else reply(conn, { ok: false, error: result.message });
  });
  if (!busy) processQueue();
}

async function processQueue(): Promise<void> {
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      await job();
    } catch (e) {
      log('job error:', String(e));
    }
  }
  busy = false;
}

function reply(conn: net.Socket, payload: unknown): void {
  try {
    conn.write(JSON.stringify(payload) + '\n');
    conn.end();
  } catch {
    // ignore
  }
}

setInterval(() => {
  if (!busy && Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    log('idle timeout — exiting');
    cleanup();
    setTimeout(() => process.exit(0), 100);
  }
}, 30_000).unref();

process.on('SIGINT', () => {
  cleanup();
  setTimeout(() => process.exit(0), 100);
});
process.on('SIGTERM', () => {
  cleanup();
  setTimeout(() => process.exit(0), 100);
});

await init();
server.listen(daemonPaths.socket, () => {
  const meta: DaemonMeta = {
    pid: process.pid,
    socket: daemonPaths.socket,
    started_at: new Date().toISOString(),
    cli_path: process.argv[1],
  };
  writeFileSync(daemonPaths.meta, JSON.stringify(meta, null, 2));
  log(`listening on ${daemonPaths.socket} (pid ${process.pid})`);
});
