export type Sections = Record<string, string>;
export type References = Record<string, string>;

/**
 * Status values for write-tool results.
 *
 * For `connect`:
 *   - `connected`          → invite sent (Pending now visible)
 *   - `accepted`           → inbound invite accepted
 *   - `already_connected`  → no-op; already 1st-degree
 *   - `pending`            → already-pending; no-op
 *   - `follow_only`        → Follow exposed but not Connect
 *   - `connect_unavailable`→ no Connect action found
 *   - `silent_reject`      → dialog closed without Pending (upsell/throttle).
 *                            Skills: skip this contact, do NOT record rate-limit,
 *                            do NOT count toward 3-consecutive-error hard-stop.
 *   - `send_failed`        → concrete failure (could not click, wrong target,
 *                            etc.). Counts as a real error.
 */
export type ConnectStatus =
  | 'connected'
  | 'accepted'
  | 'already_connected'
  | 'pending'
  | 'follow_only'
  | 'connect_unavailable'
  | 'silent_reject'
  | 'send_failed';

export type ToolResult = {
  url: string;
  sections: Sections;
  references?: References;
  profile_urn?: string;
  section_errors?: Record<string, string>;
  // write tools
  status?: string;
  sent?: boolean;
  note_sent?: boolean;
  message?: string;
  recipient_selected?: boolean;
  // Retry telemetry (populated by connect when a transient failure was
  // automatically retried). Skills don't need to act on these; purely
  // observability for learnings.
  retry_attempts?: number;
  retry_reason?: string;
  // search/job tools
  job_ids?: string[];
  // tier 2 helpers
  unknown_sections?: string[];
};

export type AuthRequiredResult = {
  status: 'auth_required';
  message: string;
};

export type ErrorResult = {
  status: 'error';
  error: string;
  detail?: string;
};

export type CommandResult = ToolResult | AuthRequiredResult | ErrorResult;

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_AUTH_REQUIRED = 2;
