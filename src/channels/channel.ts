/**
 * Channel — the contract every outbound/inbound channel implements.
 *
 * v1 channels: `email` (Gmail MCP, draft-only), `linkedin` (stickerdaniel MCP,
 * autonomous send with rate-limiter guardrails).
 *
 * Semantics:
 *   - `outbound()` returns `{ draft_id }` for channels that only draft (email)
 *     and `{ sent: true }` for channels that send directly (linkedin). The
 *     Channel is responsible for calling the rate-limiter internally; it
 *     throws a RateLimited error if the check fails so the skill can react.
 *   - `readInbox(since)` returns messages newer than `since` (ISO). Channels
 *     that page internally should return up to a reasonable batch (100).
 *   - `rateKey()` returns the rate-limiter action string (e.g. 'linkedin_connect').
 *
 * Channels do NOT touch the tracker. Skills own the tracker writes after a
 * successful outbound.
 */

export type ChannelName = 'email' | 'linkedin';

export interface OutboundMessage {
  to: { email?: string; linkedin_url?: string };
  subject?: string;                     // email only
  body: string;
  contentType?: 'text/plain' | 'text/html';
  /** LinkedIn-only: if set, send `connect_with_person` with this note instead of `send_message`. */
  asConnectionNote?: boolean;
}

export interface InboundMessage {
  id: string;                           // provider message id
  threadId: string;
  from: { email?: string; linkedin_url?: string; name?: string };
  subject?: string;
  body: string;
  received_at: string;                  // ISO
}

export interface OutboundResult {
  draft_id?: string;
  sent?: boolean;
  message_id?: string;
}

export class RateLimited extends Error {
  constructor(
    public action: string,
    public reason: string,
  ) {
    super(`rate-limited on ${action}: ${reason}`);
    this.name = 'RateLimited';
  }
}

export class ChannelError extends Error {
  constructor(public channel: ChannelName, msg: string) {
    super(`${channel} channel error: ${msg}`);
    this.name = 'ChannelError';
  }
}

export interface Channel {
  readonly name: ChannelName;
  outbound(msg: OutboundMessage): Promise<OutboundResult>;
  readInbox(since: string): Promise<InboundMessage[]>;
  readThread(threadId: string): Promise<InboundMessage[]>;
}

export async function loadChannel(name: ChannelName): Promise<Channel> {
  switch (name) {
    case 'email': {
      const m = await import('./gmail.ts');
      return m.createGmailChannel();
    }
    case 'linkedin': {
      const m = await import('./linkedin.ts');
      return m.createLinkedInChannel();
    }
  }
}
