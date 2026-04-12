/**
 * LinkedIn channel adapter (via stickerdaniel/linkedin-mcp-server).
 *
 * IMPORTANT: Same pattern as gmail.ts — actual MCP calls happen from your
 * harness, not from Node. This file documents the mapping and provides the
 * TypeScript contract.
 *
 * MCP tool mapping:
 *   outbound({to: {linkedin_url}, body, asConnectionNote}) →
 *     asConnectionNote=true → mcp__linkedin__connect_with_person({url, note: body})
 *                             + rate-limiter: linkedin_connect
 *     asConnectionNote=false → mcp__linkedin__send_message({url, body})
 *                             + rate-limiter: linkedin_message
 *   readInbox(since) →
 *     mcp__linkedin__get_inbox({since})
 *   readThread(threadId) →
 *     mcp__linkedin__get_conversation({id: threadId})
 *
 * RATE LIMITING (mandatory — enforced by skills):
 *   connection_note:  max 20/day, 80/week
 *   message:          max 40/day
 *   jittered sleep:   30–120 s between consecutive actions
 *   hard-stop:        3 consecutive connect_with_person errors → exit
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
  const mcpNotRunnable = () => {
    throw new ChannelError(
      'linkedin',
      'outbound / inbox operations run via your harness MCP (mcp__linkedin__*), not from Node. Use the skill markdown — it invokes the correct MCP tools and handles rate-limiting.',
    );
  };

  return {
    name: 'linkedin',

    async outbound(_msg: OutboundMessage): Promise<OutboundResult> {
      mcpNotRunnable();
      return { sent: false };
    },

    async readInbox(_since: string): Promise<InboundMessage[]> {
      mcpNotRunnable();
      return [];
    },

    async readThread(_threadId: string): Promise<InboundMessage[]> {
      mcpNotRunnable();
      return [];
    },
  };
}

export const LINKEDIN_MCP_MAPPING = {
  outbound: {
    rateAction(msg: OutboundMessage): 'linkedin_connect' | 'linkedin_message' {
      return msg.asConnectionNote ? 'linkedin_connect' : 'linkedin_message';
    },
    tool(msg: OutboundMessage) {
      return msg.asConnectionNote
        ? 'mcp__linkedin__connect_with_person'
        : 'mcp__linkedin__send_message';
    },
    argsFrom(msg: OutboundMessage) {
      if (!msg.to.linkedin_url) throw new ChannelError('linkedin', 'outbound requires to.linkedin_url');
      if (msg.asConnectionNote) {
        // 300 char hard limit on LinkedIn invite notes.
        if (msg.body.length > 300) {
          throw new ChannelError('linkedin', `connection note is ${msg.body.length} chars, max is 300`);
        }
        return { url: msg.to.linkedin_url, note: msg.body };
      }
      return { url: msg.to.linkedin_url, body: msg.body };
    },
  },
  readInbox: {
    tool: 'mcp__linkedin__get_inbox',
    argsFrom(_sinceIso: string) {
      return {};
    },
  },
  readThread: {
    tool: 'mcp__linkedin__get_conversation',
    argsFrom(threadId: string) {
      return { id: threadId };
    },
  },
  getProfile: {
    tool: 'mcp__linkedin__get_person_profile',
    argsFrom(url: string, sections?: string[]) {
      return { url, sections: sections ?? ['experience', 'posts', 'honors', 'certifications'] };
    },
  },
  searchPeople: {
    tool: 'mcp__linkedin__search_people',
    argsFrom(query: string, filters?: { location?: string; industry?: string; limit?: number }) {
      return { query, ...filters };
    },
  },
} as const;
