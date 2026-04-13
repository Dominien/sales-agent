import { CommandResult, EXIT_OK, EXIT_AUTH_REQUIRED, EXIT_ERROR } from './types.ts';

export function log(...args: unknown[]): void {
  process.stderr.write(args.map(stringify).join(' ') + '\n');
}

export function emit(result: CommandResult): never {
  process.stdout.write(JSON.stringify(result) + '\n');
  let code = EXIT_OK;
  if ('status' in result) {
    if (result.status === 'auth_required') code = EXIT_AUTH_REQUIRED;
    else if (result.status === 'error') code = EXIT_ERROR;
  }
  process.exit(code);
}

export function emitError(error: unknown, detail?: string): never {
  emit({
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    detail,
  });
}

export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
