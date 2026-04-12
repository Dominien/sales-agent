/**
 * Gmail channel adapter.
 *
 * IMPORTANT: Outbound (`outbound`) and inbox reads (`readInbox`, `readThread`)
 * are performed by your harness via the Gmail MCP server, not from Node. This
 * module documents the exact MCP tool mapping and provides type-safe helpers
 * that skills can reference.
 *
 * If invoked from Node without an MCP runtime, methods throw
 * `ChannelError('use-via-mcp')`. The class still serves as:
 *   - The TypeScript contract for skills
 *   - Documentation of which MCP tools to call
 *
 * MCP tool mapping:
 *   outbound({to: {email}, subject, body, contentType}) →
 *     mcp__gmail__gmail_create_draft({to: <email>, subject, body, contentType})
 *   readInbox(since) →
 *     mcp__gmail__gmail_search_messages({query: `newer_than:<Xd> in:inbox`})
 *   readThread(threadId) →
 *     mcp__gmail__gmail_read_thread({id: threadId})
 *
 * Rate limiter: skills call `rate-limiter.ts check email_draft` before
 * outbound. Gmail drafts are DRAFTS, not sends — safer default, but the cap
 * still prevents runaway draft generation.
 */

import {
  ChannelError,
  type Channel,
  type InboundMessage,
  type OutboundMessage,
  type OutboundResult,
} from './channel.ts';

export function createGmailChannel(): Channel {
  const mcpNotRunnable = () => {
    throw new ChannelError(
      'email',
      'outbound / inbox operations run via your harness MCP (mcp__gmail__*), not from Node. Use the skill markdown — it invokes the correct MCP tools.',
    );
  };

  return {
    name: 'email',

    async outbound(_msg: OutboundMessage): Promise<OutboundResult> {
      mcpNotRunnable();
      return { draft_id: 'unreachable' };
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

/**
 * Documentation-only: the exact MCP tool arguments a skill should pass
 * for each canonical Channel operation. Skills reference this file when
 * composing MCP calls.
 */
export const GMAIL_MCP_MAPPING = {
  outbound: {
    tool: 'mcp__gmail__gmail_create_draft',
    argsFrom(msg: OutboundMessage) {
      if (!msg.to.email) throw new ChannelError('email', 'outbound requires to.email');
      return {
        to: msg.to.email,
        subject: msg.subject ?? '(no subject)',
        body: msg.body,
        contentType: msg.contentType ?? 'text/plain',
      };
    },
  },
  readInbox: {
    tool: 'mcp__gmail__gmail_search_messages',
    /** `since` is ISO. Gmail only supports `newer_than:<N>d` granularity. */
    argsFrom(sinceIso: string) {
      const days = Math.max(1, Math.ceil((Date.now() - new Date(sinceIso).getTime()) / 86_400_000));
      return { query: `newer_than:${days}d in:inbox` };
    },
  },
  readThread: {
    tool: 'mcp__gmail__gmail_read_thread',
    argsFrom(threadId: string) {
      return { id: threadId };
    },
  },
  listDrafts: {
    tool: 'mcp__gmail__gmail_list_drafts',
    argsFrom(query?: string) {
      return query ? { query } : {};
    },
  },
} as const;
