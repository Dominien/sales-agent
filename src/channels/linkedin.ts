/**
 * LinkedIn channel adapter.
 *
 * The actual LinkedIn work happens via in-repo CLI scripts at
 * `src/linkedin/cli.ts`. Skills shell out to those commands directly via
 * `Bash:` calls — no MCP server, no `claude mcp add`.
 *
 * This file is the documented contract describing how skill operations map
 * to CLI invocations and which rate-limiter key each consumes.
 *
 * RATE LIMITING (mandatory — enforced by skills):
 *   connection_note:  max 20/day, 80/week
 *   message:          max 40/day
 *   jittered sleep:   30–120 s between consecutive actions
 *   hard-stop:        3 consecutive connect errors → exit
 *
 * These defaults stay below LinkedIn's ~100/week flagging threshold.
 * See docs/rate-limits.md for what to do if the account gets flagged.
 */

import {
  ChannelError,
  type Channel,
  type InboundMessage,
  type OutboundMessage,
  type OutboundResult,
} from './channel.ts';

export function createLinkedInChannel(): Channel {
  const cliOnly = () => {
    throw new ChannelError(
      'linkedin',
      'LinkedIn operations run via the in-repo CLI: `npx tsx src/linkedin/cli.ts <command>`. Use the skill markdown — it shells out to the right command.',
    );
  };

  return {
    name: 'linkedin',
    async outbound(_msg: OutboundMessage): Promise<OutboundResult> {
      cliOnly();
      return { sent: false };
    },
    async readInbox(_since: string): Promise<InboundMessage[]> {
      cliOnly();
      return [];
    },
    async readThread(_threadId: string): Promise<InboundMessage[]> {
      cliOnly();
      return [];
    },
  };
}

/**
 * Maps Node-side operations to the CLI command + argv that skills should run.
 *
 * Each entry produces:
 *   { command: string, args: string[], rateAction?: string }
 *
 * Skills compose the command line with `npx tsx src/linkedin/cli.ts <command> <...args>`
 * and call the rate-limiter with `rateAction` (if defined) before executing.
 */
export const LINKEDIN_CLI_MAPPING = {
  outbound: {
    rateAction(msg: OutboundMessage): 'linkedin_connect' | 'linkedin_message' {
      return msg.asConnectionNote ? 'linkedin_connect' : 'linkedin_message';
    },
    cliFor(msg: OutboundMessage): { command: string; args: string[] } {
      if (!msg.to.linkedin_url) throw new ChannelError('linkedin', 'outbound requires to.linkedin_url');
      const username = extractUsername(msg.to.linkedin_url);
      if (msg.asConnectionNote) {
        if (msg.body.length > 300) {
          throw new ChannelError('linkedin', `connection note is ${msg.body.length} chars, max is 300`);
        }
        return {
          command: 'connect',
          args: ['--linkedin-username', username, '--note', msg.body],
        };
      }
      return {
        command: 'send-message',
        args: ['--linkedin-username', username, '--message', msg.body, '--confirm-send', 'true'],
      };
    },
  },
  readInbox: {
    cliFor(_sinceIso: string, limit = 20): { command: string; args: string[] } {
      return { command: 'get-inbox', args: ['--limit', String(limit)] };
    },
  },
  readThread: {
    cliFor(threadId: string): { command: string; args: string[] } {
      return { command: 'get-conversation', args: ['--thread-id', threadId] };
    },
  },
  getProfile: {
    cliFor(linkedinUrl: string, sections?: string[]): { command: string; args: string[] } {
      const username = extractUsername(linkedinUrl);
      const secs = (sections ?? ['experience', 'posts', 'honors', 'certifications']).join(',');
      return { command: 'get-person-profile', args: ['--linkedin-username', username, '--sections', secs] };
    },
  },
  searchPeople: {
    cliFor(
      keywords: string,
      filters?: { location?: string },
    ): { command: string; args: string[] } {
      const args = ['--keywords', keywords];
      if (filters?.location) args.push('--location', filters.location);
      return { command: 'search-people', args };
    },
  },
  searchJobs: {
    cliFor(
      keywords: string,
      filters?: {
        location?: string;
        maxPages?: number;
        datePosted?: string;
        jobType?: string;
        experienceLevel?: string;
        workType?: string;
        easyApply?: boolean;
        sortBy?: string;
      },
    ): { command: string; args: string[] } {
      const args = ['--keywords', keywords];
      if (filters?.location) args.push('--location', filters.location);
      if (filters?.maxPages) args.push('--max-pages', String(filters.maxPages));
      if (filters?.datePosted) args.push('--date-posted', filters.datePosted);
      if (filters?.jobType) args.push('--job-type', filters.jobType);
      if (filters?.experienceLevel) args.push('--experience-level', filters.experienceLevel);
      if (filters?.workType) args.push('--work-type', filters.workType);
      if (filters?.easyApply) args.push('--easy-apply', 'true');
      if (filters?.sortBy) args.push('--sort-by', filters.sortBy);
      return { command: 'search-jobs', args };
    },
  },
  getCompanyProfile: {
    cliFor(companySlug: string, sections?: string[]): { command: string; args: string[] } {
      const args = ['--company-name', companySlug];
      if (sections?.length) args.push('--sections', sections.join(','));
      return { command: 'get-company-profile', args };
    },
  },
  getCompanyPosts: {
    cliFor(companySlug: string): { command: string; args: string[] } {
      return { command: 'get-company-posts', args: ['--company-name', companySlug] };
    },
  },
  getJobDetails: {
    cliFor(jobId: string): { command: string; args: string[] } {
      return { command: 'get-job-details', args: ['--job-id', jobId] };
    },
  },
} as const;

function extractUsername(linkedinUrl: string): string {
  const m = linkedinUrl.match(/\/in\/([^/?#]+)/);
  if (!m) throw new ChannelError('linkedin', `Could not extract username from URL: ${linkedinUrl}`);
  return m[1];
}
