/**
 * Skip-flag detection for tracker rows.
 *
 * Real-world CRM notes accumulate variants of "don't contact this person"
 * phrasing: "owned by another rep", "declined", "parked for personal
 * reasons", "lost to competitor". The retrospective on Wave 1 showed that
 * treating every exclusion as a single blob lost information — so we
 * categorize into three tiers:
 *
 *   - `hard`     : never contact (unsubscribe, legal, bounce, negative_hard)
 *   - `warm`     : someone else owns the relationship, or it was recently
 *                  closed-lost / declined — come back later but not now
 *   - `personal` : life-event pauses (health, parental leave, bereavement)
 *
 * The canonical `do_not_contact` column (see db.ts) is consulted first; if
 * set, it wins. Otherwise we scan `notes_summary` and `lead_status` with a
 * pattern table. Patterns are deliberately minimal and English+German-only
 * — the goal is good recall, not linguistic sophistication. Anything we
 * miss just flows through to the next layer (skill's own dedup).
 */

import type { TrackerRow } from './db.ts';

export type SkipTier = 'hard' | 'warm' | 'personal';

export interface SkipReason {
  tier: SkipTier;
  code: string;
  matched: string;
  source: 'do_not_contact' | 'lead_status' | 'notes_summary' | 'reply_classification';
}

interface Pattern {
  tier: SkipTier;
  code: string;
  re: RegExp;
}

// Order matters only for reporting (first match wins). Patterns are
// lowercased at match time.
const NOTE_PATTERNS: Pattern[] = [
  // Hard skips — ethical / legal / bounce
  { tier: 'hard', code: 'unsubscribe', re: /\b(unsubscribe|opt[\s-]?out|do not (email|contact)|abmelden|austragen)\b/i },
  { tier: 'hard', code: 'bounce', re: /\b(hard[\s-]?bounce|undeliverable|no such user|mailbox full|invalid address)\b/i },
  { tier: 'hard', code: 'left_company', re: /\b(left (the )?company|no longer (at|with)|nicht mehr (bei|im unternehmen))\b/i },
  { tier: 'hard', code: 'negative_hard', re: /\b(not interested|stop (contacting|reaching out)|kein interesse|unterlassen)\b/i },

  // Warm skips — don't touch right now, but not forever
  { tier: 'warm', code: 'owned_by_other_rep', re: /\b(owned by|assigned to|handled by|another rep|kolleg(e|in)( betreut)?)\b/i },
  { tier: 'warm', code: 'lost_to_competitor', re: /\b(lost to|went with|chose)\s+(a\s+)?competitor|zu(m)? wettbewerber|mitbewerber\b/i },
  { tier: 'warm', code: 'closed_lost', re: /\b(closed[\s-]?lost|verloren|nicht zustande gekommen)\b/i },
  { tier: 'warm', code: 'declined', re: /\b(declined|abgelehnt|passt (aktuell|derzeit) nicht)\b/i },
  { tier: 'warm', code: 'parked', re: /\b(parked|on hold|auf eis|zurückgestellt|pausiert)\b/i },
  { tier: 'warm', code: 'bad_timing', re: /\b(bad timing|come back (in|next)|q[1-4] (next year|next quarter)|nächstes quartal)\b/i },

  // Personal skips — life events; human on the other end deserves space
  { tier: 'personal', code: 'parental_leave', re: /\b(parental leave|maternity|paternity|elternzeit|mutterschutz)\b/i },
  { tier: 'personal', code: 'health', re: /\b(health|sick leave|medical|krank(heit|schreibung)?|reha)\b/i },
  { tier: 'personal', code: 'bereavement', re: /\b(bereavement|family loss|trauerfall)\b/i },
  { tier: 'personal', code: 'sabbatical', re: /\b(sabbatical|auszeit)\b/i },
];

// Map values that the tracker's `do_not_contact` column can take to tiers.
const DNC_TIERS: Record<string, SkipTier> = {
  bounce: 'hard',
  unsubscribe: 'hard',
  negative_hard: 'hard',
  manual: 'hard',
};

/**
 * Classify a tracker row. Returns `null` if the contact is freely contactable
 * (no skip flags detected).
 */
export function classifySkip(row: Pick<TrackerRow,
  'do_not_contact' | 'lead_status' | 'notes_summary' | 'reply_classification'
>): SkipReason | null {
  // 1. Canonical do_not_contact column wins.
  if (row.do_not_contact) {
    return {
      tier: DNC_TIERS[row.do_not_contact] ?? 'hard',
      code: row.do_not_contact,
      matched: row.do_not_contact,
      source: 'do_not_contact',
    };
  }

  // 2. Reply classification (BOUNCE, NEGATIVE_HARD should already have set
  //    do_not_contact via inbox-classifier, but belt-and-braces).
  if (row.reply_classification === 'BOUNCE' || row.reply_classification === 'NEGATIVE_HARD') {
    return {
      tier: 'hard',
      code: row.reply_classification.toLowerCase(),
      matched: row.reply_classification,
      source: 'reply_classification',
    };
  }

  // 3. Lead status heuristics.
  const leadStatus = (row.lead_status ?? '').toUpperCase();
  if (leadStatus === 'UNQUALIFIED' || leadStatus === 'BAD_FIT') {
    return { tier: 'hard', code: 'unqualified', matched: leadStatus, source: 'lead_status' };
  }

  // 4. Free-text scan over notes_summary.
  const notes = row.notes_summary ?? '';
  if (notes) {
    for (const p of NOTE_PATTERNS) {
      const m = notes.match(p.re);
      if (m) {
        return {
          tier: p.tier,
          code: p.code,
          matched: m[0],
          source: 'notes_summary',
        };
      }
    }
  }

  return null;
}

/**
 * Filter a tracker row for outreach eligibility.
 *
 * @param row         Tracker row to test.
 * @param allowTiers  Skip tiers to tolerate. Default `[]` (reject any skip).
 *                    Pass `['personal']` in "back-to-work" campaigns that
 *                    deliberately re-engage life-event pauses.
 */
export function isContactable(
  row: Pick<TrackerRow,
    'do_not_contact' | 'lead_status' | 'notes_summary' | 'reply_classification'
  >,
  allowTiers: SkipTier[] = [],
): boolean {
  const reason = classifySkip(row);
  if (!reason) return true;
  return allowTiers.includes(reason.tier);
}
