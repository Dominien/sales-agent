#!/usr/bin/env node
/**
 * Interactive setup wizard. Writes agent.config.json + .env skeleton.
 *
 * Flow:
 *   1. Which CRM?           (sqlite | hubspot | close | attio | salesforce)
 *   2. Which channels?      (email, linkedin — multi-select)
 *   3. Sender identity      (name, email, linkedin_url, company, offering, scheduling_link)
 *   4. Rate-limit overrides (press enter to accept defaults)
 *
 * Prompts use the Node built-in `readline` — no extra dependencies.
 */

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../agent.config.json');
const ENV_PATH = resolve(__dirname, '../.env');
const ENV_EXAMPLE_PATH = resolve(__dirname, '../.env.example');

const rl = createInterface({ input: stdin, output: stdout });

async function ask(q: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue !== undefined ? ` (${defaultValue || 'blank'})` : '';
  const a = (await rl.question(`${q}${suffix}: `)).trim();
  return a || defaultValue || '';
}

async function askOneOf(q: string, options: string[], defaultValue?: string): Promise<string> {
  while (true) {
    const a = await ask(`${q} [${options.join(' | ')}]`, defaultValue);
    if (options.includes(a)) return a;
    console.log(`  ↳ must be one of: ${options.join(', ')}`);
  }
}

async function askMulti(q: string, options: string[], defaultValue: string[]): Promise<string[]> {
  while (true) {
    const a = await ask(`${q} [comma-separated: ${options.join(',')}]`, defaultValue.join(','));
    const parts = a.split(',').map((s) => s.trim()).filter(Boolean);
    const valid = parts.every((p) => options.includes(p));
    if (valid && parts.length > 0) return parts;
    console.log(`  ↳ must be a non-empty comma-separated subset of: ${options.join(', ')}`);
  }
}

async function askInt(q: string, defaultValue: number): Promise<number> {
  while (true) {
    const a = await ask(q, String(defaultValue));
    const n = parseInt(a, 10);
    if (!isNaN(n) && n > 0) return n;
    console.log('  ↳ must be a positive integer');
  }
}

function banner() {
  console.log(`
╭──────────────────────────────────────────────────────────╮
│   sales-agent — interactive setup                         │
│   Writes agent.config.json + .env skeleton                │
╰──────────────────────────────────────────────────────────╯
`);
}

async function main() {
  banner();

  if (existsSync(CONFIG_PATH)) {
    const overwrite = await askOneOf('agent.config.json already exists. Overwrite?', ['y', 'n'], 'n');
    if (overwrite !== 'y') {
      console.log('Aborted. Edit agent.config.json manually or delete it first.');
      rl.close();
      return;
    }
  }

  // 1. CRM
  console.log('\n── Step 1/4: choose your CRM ──');
  console.log('   sqlite     — no external CRM; tracker.db is the CRM (fastest start)');
  console.log('   hubspot    — HubSpot via hosted MCP (mcp.hubspot.com/anthropic)');
  console.log('   close      — Close via hosted MCP (mcp.close.com/mcp)');
  console.log('   attio      — Attio via hosted MCP');
  console.log('   salesforce — Salesforce via self-hosted MCP (salesforcecli/mcp)\n');
  const crm = await askOneOf('Choose CRM', ['sqlite', 'hubspot', 'close', 'attio', 'salesforce'], 'sqlite');

  // 2. Channels
  console.log('\n── Step 2/4: choose channels ──');
  const channels = await askMulti('Channels to enable', ['email', 'linkedin'], ['email']);

  // 3. Sender
  console.log('\n── Step 3/4: sender identity ──');
  const name = await ask('Your name');
  const email = await ask('Your email');
  const linkedin_url = await ask('Your LinkedIn URL', '');
  const company = await ask('Your company');
  const scheduling_link = await ask('Scheduling link (e.g. https://cal.com/...)', '');
  const offering = await ask('1–2 sentence description of what you sell and who for');

  // 4. Rate limits
  console.log('\n── Step 4/4: rate limits (press enter to accept defaults) ──');
  console.log('  Defaults stay below LinkedIn\'s ~100/week flagging threshold.');
  const email_daily = channels.includes('email') ? await askInt('Email drafts per day', 200) : 200;
  const li_connect_daily = channels.includes('linkedin') ? await askInt('LinkedIn connection requests per day', 20) : 20;
  const li_connect_weekly = channels.includes('linkedin') ? await askInt('LinkedIn connection requests per week', 80) : 80;
  const li_message_daily = channels.includes('linkedin') ? await askInt('LinkedIn messages per day', 40) : 40;

  const config = {
    crm,
    channels,
    sender: { name, email, linkedin_url, company, scheduling_link, offering },
    rate_limits: {
      email_draft: { daily: email_daily },
      linkedin_connect: { daily: li_connect_daily, weekly: li_connect_weekly },
      linkedin_message: { daily: li_message_daily },
    },
    defaults: {
      language: 'auto',
      channel_priority: channels.includes('linkedin') ? ['linkedin', 'email'] : ['email'],
      tier_filter_default: ['A', 'B'],
    },
    crm_options: {},
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ Wrote ${CONFIG_PATH}`);

  // .env skeleton (only the keys the chosen stack actually needs)
  if (!existsSync(ENV_PATH) && existsSync(ENV_EXAMPLE_PATH)) {
    writeFileSync(ENV_PATH, readFileSync(ENV_EXAMPLE_PATH, 'utf-8'), 'utf-8');
    console.log(`✓ Copied .env.example → .env (edit to add credentials for CLI fallback path only)`);
  }

  // Next steps
  console.log(`\n── Next steps ──`);
  if (channels.includes('linkedin')) {
    console.log(`  1. LinkedIn auth (one-time):`);
    console.log(`       brew install uv`);
    console.log(`       uvx linkedin-scraper-mcp@latest --login`);
    console.log(`       claude mcp add linkedin --scope user --env UV_HTTP_TIMEOUT=300 -- uvx linkedin-scraper-mcp@latest`);
  }
  if (crm === 'hubspot') {
    console.log(`  • HubSpot: connect via your harness's OAuth (Claude Code: claude.ai HubSpot).`);
  } else if (crm === 'close') {
    console.log(`  • Close: OAuth via harness. See docs/crm-adapters.md#close`);
  } else if (crm === 'attio') {
    console.log(`  • Attio: OAuth via harness. See docs/crm-adapters.md#attio`);
  } else if (crm === 'salesforce') {
    console.log(`  • Salesforce: install sfdx CLI + authorize org. See docs/crm-adapters.md#salesforce`);
  } else {
    console.log(`  • SQLite: no setup needed. tracker.db will be created on first tracker command.`);
  }
  console.log(`\n  Verify:`);
  console.log(`    npx tsx src/tracker.ts read   # → [] if fresh`);
  console.log(`    npx tsx src/config.ts         # prints resolved config`);
  console.log(`\n  Invoke a skill from your harness using prompts/invoke-skill.md.\n`);

  rl.close();
}

main().catch((e) => {
  console.error('Setup failed:', (e as Error).message);
  rl.close();
  process.exit(1);
});
