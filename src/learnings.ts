#!/usr/bin/env node
/**
 * Learnings CLI — append entries to knowledge/learnings.md Section B (Running Log).
 *
 * Every skill run ends with one entry: either a heartbeat (default) or an observation
 * (if a genuine pattern was noticed: ≥3 similar signals, unexpected cluster, or a segment
 * behaving differently from Section A rules).
 *
 * Usage:
 *   tsx src/learnings.ts append heartbeat --skill <skill> --text "<one-liner>"
 *   tsx src/learnings.ts append observation --skill <skill> --headline "..." --context "..." --observed "..." --apply "..."
 *   tsx src/learnings.ts read [--section A|B|C] [--limit N] [--skill <name>]
 *
 * Behavior:
 *   - Append entries are inserted right after the <!-- LEARNINGS_LOG_START --> marker (newest first).
 *   - Section B grows unbounded. Trim manually via your editor if it ever gets too long.
 *   - Read parses the file into {sectionA_raw, sectionB (parsed entries), sectionC_raw}. Used by the dashboard UI.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = resolve(__dirname, '../knowledge/learnings.md');

const LOG_START = '<!-- LEARNINGS_LOG_START -->';
const LOG_END = '<!-- LEARNINGS_LOG_END -->';

interface ParsedArgs {
  [key: string]: string | true | undefined;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      const val: string | true = next && !next.startsWith('--') ? next : true;
      parsed[key] = val;
      if (val !== true) i++;
    }
  }
  return parsed;
}

function getString(opts: ParsedArgs, key: string): string | undefined {
  const v = opts[key];
  return typeof v === 'string' ? v : undefined;
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readLearnings(): string {
  if (!existsSync(LEARNINGS_PATH)) {
    console.error(`Error: ${LEARNINGS_PATH} not found. Expected the restructured learnings.md with running-log markers.`);
    process.exit(1);
  }
  return readFileSync(LEARNINGS_PATH, 'utf-8');
}

interface LogSection {
  before: string;
  log: string;
  after: string;
}

function getLogSection(content: string): LogSection {
  const startIdx = content.indexOf(LOG_START);
  const endIdx = content.indexOf(LOG_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.error(
      `Error: Running log markers not found in learnings.md. Expected ${LOG_START} ... ${LOG_END}.`,
    );
    process.exit(1);
  }
  const before = content.slice(0, startIdx + LOG_START.length);
  const log = content.slice(startIdx + LOG_START.length, endIdx);
  const after = content.slice(endIdx);
  return { before, log, after };
}

function splitEntries(log: string): string[] {
  // Entries start with '### ' headings. Split the log into per-entry blocks.
  const lines = log.split('\n');
  const entries: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (current.length > 0 && current.some((l) => l.trim())) {
        entries.push(current.join('\n').trim());
      }
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0 && current.some((l) => l.trim())) {
    const tail = current.join('\n').trim();
    if (tail) entries.push(tail);
  }
  return entries;
}

function appendEntry(newEntry: string): void {
  const content = readLearnings();
  const { before, log, after } = getLogSection(content);
  const existing = splitEntries(log);

  // Newest first, grows unbounded
  const allEntries = [newEntry, ...existing];

  const newLog = allEntries.length > 0 ? '\n\n' + allEntries.join('\n\n') + '\n\n' : '\n\n';
  writeFileSync(LEARNINGS_PATH, before + newLog + after, 'utf-8');
}

function formatHeartbeat(skill: string, text: string): string {
  return `### ${todayISODate()} · ${skill} · heartbeat\n- ${text}`;
}

// ----- Read: parse learnings.md into structured sections -----

type EntryType = 'heartbeat' | 'observation';

interface ParsedEntry {
  date: string;
  skill: string;
  headline: string;
  type: EntryType;
  body: string;
}

interface LearningsData {
  sectionA_raw: string;
  sectionB: ParsedEntry[];
  sectionC_raw: string;
}

function sliceBetween(content: string, startHeading: string, endHeading: string): string {
  const startIdx = content.indexOf(startHeading);
  if (startIdx === -1) return '';
  const afterStart = content.slice(startIdx);
  const endIdx = afterStart.indexOf(endHeading, startHeading.length);
  if (endIdx === -1) return afterStart.trim();
  return afterStart.slice(0, endIdx).trim();
}

function parseEntry(raw: string): ParsedEntry | null {
  // Heading format: ### YYYY-MM-DD · <skill> · <headline>
  const lines = raw.split('\n');
  const headingLine = lines[0] || '';
  if (!headingLine.startsWith('### ')) return null;

  const headingBody = headingLine.slice(4).trim();
  const parts = headingBody.split(' · ').map((s) => s.trim());
  if (parts.length < 3) return null;

  const [date, skill, ...rest] = parts;
  const headline = rest.join(' · ');
  const type: EntryType = headline.toLowerCase() === 'heartbeat' ? 'heartbeat' : 'observation';
  const body = lines.slice(1).join('\n').trim();

  return { date, skill, headline, type, body };
}

function readAllLearnings(): LearningsData {
  const content = readLearnings();

  const sectionA_raw = sliceBetween(content, '## Section A', '## Section B');
  const sectionC_raw = sliceBetween(content, '## Section C', '## Appendix');

  const { log } = getLogSection(content);
  const rawEntries = splitEntries(log);
  const sectionB = rawEntries
    .map((raw) => parseEntry(raw))
    .filter((e): e is ParsedEntry => e !== null);

  return { sectionA_raw, sectionB, sectionC_raw };
}

function filterEntries(
  entries: ParsedEntry[],
  skill: string | undefined,
  limit: number | undefined,
): ParsedEntry[] {
  let result = entries;
  if (skill) result = result.filter((e) => e.skill === skill);
  if (limit && limit > 0) result = result.slice(0, limit);
  return result;
}

function readCmd(opts: ParsedArgs): void {
  const sectionFilter = getString(opts, 'section');
  const skillFilter = getString(opts, 'skill');
  const limitStr = getString(opts, 'limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const data = readAllLearnings();

  if (sectionFilter === 'A' || sectionFilter === 'a') {
    console.log(JSON.stringify({ sectionA_raw: data.sectionA_raw }, null, 2));
    return;
  }
  if (sectionFilter === 'B' || sectionFilter === 'b') {
    console.log(
      JSON.stringify({ sectionB: filterEntries(data.sectionB, skillFilter, limit) }, null, 2),
    );
    return;
  }
  if (sectionFilter === 'C' || sectionFilter === 'c') {
    console.log(JSON.stringify({ sectionC_raw: data.sectionC_raw }, null, 2));
    return;
  }

  // No section filter → return everything (with skill/limit applied to B)
  const out: LearningsData = {
    sectionA_raw: data.sectionA_raw,
    sectionB: filterEntries(data.sectionB, skillFilter, limit),
    sectionC_raw: data.sectionC_raw,
  };
  console.log(JSON.stringify(out, null, 2));
}

function formatObservation(
  skill: string,
  headline: string,
  context: string,
  observed: string,
  apply: string,
): string {
  return (
    `### ${todayISODate()} · ${skill} · ${headline}\n` +
    `- **Context:** ${context}\n` +
    `- **Observed:** ${observed}\n` +
    `- **Apply next time:** ${apply}`
  );
}

function printHelp(): void {
  console.log(`Usage:
  tsx src/learnings.ts append <heartbeat|observation> [options]
  tsx src/learnings.ts read [--section A|B|C] [--limit N] [--skill <name>]

Append heartbeat (default end-of-run entry, one-line summary):
  tsx src/learnings.ts append heartbeat --skill <skill> --text "<one-liner>"

Append observation (when a genuine pattern was noticed):
  tsx src/learnings.ts append observation --skill <skill> --headline "..." \\
    --context "..." --observed "..." --apply "..."

Read (parse learnings.md into structured JSON — used by the dashboard UI):
  tsx src/learnings.ts read                              # all sections
  tsx src/learnings.ts read --section B --limit 20       # last 20 entries of Section B
  tsx src/learnings.ts read --section B --skill inbox-classifier

Skills should append exactly one entry per run: observation if something notable was
seen, otherwise heartbeat. Entries land in knowledge/learnings.md Section B (newest
first). The log grows unbounded — trim manually via your editor if it ever gets too long.`);
}

const [, , command, subcommand, ...rest] = process.argv;

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'read') {
  // For `read`, subcommand is actually the first option arg — put it back in the rest
  const readArgs = subcommand !== undefined ? [subcommand, ...rest] : rest;
  readCmd(parseArgs(readArgs));
  process.exit(0);
}

if (command !== 'append') {
  console.error(`Unknown command: ${command}. Run with --help for usage.`);
  process.exit(1);
}

const opts = parseArgs(rest);

if (subcommand === 'heartbeat') {
  const skill = getString(opts, 'skill');
  const text = getString(opts, 'text');
  if (!skill || !text) {
    console.error('Missing --skill or --text. Run with --help for usage.');
    process.exit(1);
  }
  appendEntry(formatHeartbeat(skill, text));
  console.log(`Appended heartbeat: ${skill}`);
} else if (subcommand === 'observation') {
  const skill = getString(opts, 'skill');
  const headline = getString(opts, 'headline');
  const context = getString(opts, 'context');
  const observed = getString(opts, 'observed');
  const apply = getString(opts, 'apply');
  if (!skill || !headline || !context || !observed || !apply) {
    console.error(
      'Missing one of: --skill, --headline, --context, --observed, --apply. Run with --help for usage.',
    );
    process.exit(1);
  }
  appendEntry(formatObservation(skill, headline, context, observed, apply));
  console.log(`Appended observation: ${skill} · ${headline}`);
} else {
  console.error(
    `Unknown subcommand: ${subcommand ?? '(none)'}. Use 'heartbeat' or 'observation'. Run with --help for usage.`,
  );
  process.exit(1);
}
