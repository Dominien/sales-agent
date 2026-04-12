/**
 * Loads and validates `agent.config.json`. Returns a typed Config object that
 * skills and utilities can import.
 *
 * Does NOT instantiate adapters/channels (they live in src/adapters/ and
 * src/channels/ and are selected by name at call time — this keeps this module
 * free of MCP / HTTP dependencies and avoids circular imports).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../agent.config.json');

export type CRMName = 'sqlite' | 'hubspot' | 'close' | 'attio' | 'salesforce';
export type ChannelName = 'email' | 'linkedin';

export interface Sender {
  name: string;
  email: string;
  linkedin_url: string;
  company: string;
  scheduling_link: string;
  offering: string;
}

export interface RateLimitSpec {
  daily: number;
  weekly?: number;
}

export interface Config {
  crm: CRMName;
  channels: ChannelName[];
  sender: Sender;
  rate_limits: {
    email_draft: RateLimitSpec;
    linkedin_connect: RateLimitSpec;
    linkedin_message: RateLimitSpec;
  };
  defaults: {
    language: 'auto' | 'en' | 'de';
    channel_priority: ChannelName[];
    tier_filter_default: Array<'A' | 'B' | 'C' | 'D'>;
  };
  crm_options: {
    hubspot?: { owner_email?: string };
    close?: { organization_id?: string };
    attio?: { workspace_id?: string };
    salesforce?: { org_alias?: string };
  };
}

const DEFAULT_CONFIG: Config = {
  crm: 'sqlite',
  channels: ['email'],
  sender: {
    name: '',
    email: '',
    linkedin_url: '',
    company: '',
    scheduling_link: '',
    offering: '',
  },
  rate_limits: {
    email_draft: { daily: 200 },
    linkedin_connect: { daily: 20, weekly: 80 },
    linkedin_message: { daily: 40 },
  },
  defaults: {
    language: 'auto',
    channel_priority: ['linkedin', 'email'],
    tier_filter_default: ['A', 'B'],
  },
  crm_options: {},
};

const VALID_CRMS: CRMName[] = ['sqlite', 'hubspot', 'close', 'attio', 'salesforce'];
const VALID_CHANNELS: ChannelName[] = ['email', 'linkedin'];

export class ConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ConfigError';
  }
}

function validate(cfg: unknown): Config {
  if (!cfg || typeof cfg !== 'object') throw new ConfigError('config is not an object');
  const c = cfg as Partial<Config>;

  if (!c.crm || !VALID_CRMS.includes(c.crm)) {
    throw new ConfigError(`invalid crm: ${c.crm}. Must be one of: ${VALID_CRMS.join(', ')}`);
  }
  if (!Array.isArray(c.channels) || c.channels.length === 0) {
    throw new ConfigError('channels must be a non-empty array');
  }
  for (const ch of c.channels) {
    if (!VALID_CHANNELS.includes(ch)) {
      throw new ConfigError(`invalid channel: ${ch}. Must be one of: ${VALID_CHANNELS.join(', ')}`);
    }
  }
  if (!c.sender || typeof c.sender !== 'object') {
    throw new ConfigError('sender is required');
  }
  const s = c.sender as Partial<Sender>;
  for (const f of ['name', 'email', 'company', 'offering'] as const) {
    if (!s[f] || typeof s[f] !== 'string' || !s[f]?.trim()) {
      throw new ConfigError(`sender.${f} is required`);
    }
  }

  // Merge with defaults for optional sections
  const merged: Config = {
    crm: c.crm,
    channels: c.channels,
    sender: { ...DEFAULT_CONFIG.sender, ...s } as Sender,
    rate_limits: { ...DEFAULT_CONFIG.rate_limits, ...(c.rate_limits ?? {}) } as Config['rate_limits'],
    defaults: { ...DEFAULT_CONFIG.defaults, ...(c.defaults ?? {}) } as Config['defaults'],
    crm_options: { ...DEFAULT_CONFIG.crm_options, ...(c.crm_options ?? {}) } as Config['crm_options'],
  };

  return merged;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  if (!existsSync(CONFIG_PATH)) {
    throw new ConfigError(
      `agent.config.json not found at ${CONFIG_PATH}. Run \`npx tsx src/init.ts\` to create it.`,
    );
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`invalid JSON in agent.config.json: ${(e as Error).message}`);
  }
  cached = validate(parsed);
  return cached;
}

export function clearConfigCache(): void {
  cached = null;
}

// CLI: print the resolved config as JSON (useful for debugging)
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const cfg = loadConfig();
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
