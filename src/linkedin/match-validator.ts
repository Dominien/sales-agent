/**
 * Match-confidence validator for LinkedIn search hits.
 *
 * In Wave 1, ~15% of search queries returned the wrong person at rank 1.
 * Typical cause: the tracker had empty or domain-only company data, and the
 * platform ranked a namesake at a different current employer first. The
 * runner accepted the top hit without scoring.
 *
 * This validator scores candidates against the tracker's expectations across
 * three independent signals:
 *
 *   1. Company overlap      (token Jaccard + domain/normalized fuzzy match)
 *   2. Location overlap     (token overlap after case-folding)
 *   3. Surname uniqueness   (how common is the lastname in the candidate set)
 *
 * A score ≥ `confidenceThreshold` is "confident"; below is "ambiguous".
 * Skills call `validate(...)` with the tracker's known fields and the top-N
 * candidates; the returned verdict tells them whether to connect straight
 * through, or stash the ambiguous pick in `output/research/ambiguous/` and
 * move on without sending.
 *
 * No network calls; no Playwright dependency. Pure string math.
 */

export interface Candidate {
  linkedin_username: string;
  name: string;
  headline?: string;
  company?: string;
  location?: string;
  /** Optional rank from the platform (1 = top hit). */
  rank?: number;
}

export interface Expected {
  firstname?: string;
  lastname?: string;
  company?: string;
  location?: string;
}

export interface ScoredCandidate {
  candidate: Candidate;
  /** Sum of signal scores, max 1.0. */
  score: number;
  signals: {
    surname: number;
    company: number;
    location: number;
    firstname: number;
  };
}

export interface MatchVerdict {
  /** `'confident'` when best score ≥ threshold AND no runner-up within `ambiguityMargin`. */
  verdict: 'confident' | 'ambiguous' | 'no_match';
  ranked: ScoredCandidate[];
  top?: ScoredCandidate;
  runnerUp?: ScoredCandidate;
  reason: string;
}

export interface ValidatorOpts {
  /** Minimum score for a candidate to be considered a real match. Default 0.55. */
  confidenceThreshold?: number;
  /** Minimum score gap between #1 and #2 for "confident". Default 0.2. */
  ambiguityMargin?: number;
}

// ─── Token helpers ──────────────────────────────────────────────────────

const STOPWORDS = new Set([
  // Company suffixes
  'gmbh', 'ag', 'kg', 'ohg', 'ug', 'mbh', 'se', 'llc', 'ltd', 'inc', 'corp', 'corporation',
  'co', 'company', 'group', 'holding', 'holdings', 'international', 'partners',
  // Generic
  'the', 'and', 'of', 'for', 'a', 'an', 'der', 'die', 'das', 'und',
]);

function tokenize(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    // strip common company-legal suffixes / email domain trailing parts
    .replace(/\.[a-z]{2,6}\b/g, ' ')
    .replace(/[^a-z0-9äöüß\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Signal scorers ─────────────────────────────────────────────────────

function surnameUniqueness(
  expected: Expected,
  candidate: Candidate,
  all: Candidate[],
): number {
  const wantLast = (expected.lastname ?? '').toLowerCase().trim();
  if (!wantLast) return 0.5; // no info → neutral
  const candLast = (candidate.name.split(/\s+/).slice(-1)[0] ?? '').toLowerCase();
  const nameMatch = candLast && candLast === wantLast ? 1 : 0;
  if (!nameMatch) return 0;

  // Dampen if many candidates share this surname (common name).
  const shared = all.filter((c) => (c.name.split(/\s+/).slice(-1)[0] ?? '').toLowerCase() === wantLast).length;
  if (shared <= 1) return 1;
  if (shared === 2) return 0.8;
  if (shared === 3) return 0.6;
  return 0.4;
}

function firstnameOverlap(expected: Expected, candidate: Candidate): number {
  const wantFirst = (expected.firstname ?? '').toLowerCase().trim();
  if (!wantFirst) return 0.5;
  const candFirst = (candidate.name.split(/\s+/)[0] ?? '').toLowerCase();
  return candFirst === wantFirst ? 1 : 0;
}

function companyOverlap(expected: Expected, candidate: Candidate): number {
  const want = tokenize(expected.company);
  const have = tokenize([candidate.company, candidate.headline].filter(Boolean).join(' '));
  if (!want.length) return 0.5; // no info → neutral
  if (!have.length) return 0;
  return jaccard(want, have);
}

function locationOverlap(expected: Expected, candidate: Candidate): number {
  const want = tokenize(expected.location);
  const have = tokenize(candidate.location);
  if (!want.length) return 0.5;
  if (!have.length) return 0;
  return jaccard(want, have);
}

// ─── Public API ─────────────────────────────────────────────────────────

const WEIGHTS = {
  surname: 0.35,
  firstname: 0.15,
  company: 0.35,
  location: 0.15,
};

export function scoreCandidates(
  expected: Expected,
  candidates: Candidate[],
): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const signals = {
        surname: surnameUniqueness(expected, candidate, candidates),
        firstname: firstnameOverlap(expected, candidate),
        company: companyOverlap(expected, candidate),
        location: locationOverlap(expected, candidate),
      };
      const score =
        signals.surname * WEIGHTS.surname +
        signals.firstname * WEIGHTS.firstname +
        signals.company * WEIGHTS.company +
        signals.location * WEIGHTS.location;
      return { candidate, score, signals };
    })
    .sort((a, b) => b.score - a.score);
}

export function validate(
  expected: Expected,
  candidates: Candidate[],
  opts: ValidatorOpts = {},
): MatchVerdict {
  const threshold = opts.confidenceThreshold ?? 0.55;
  const margin = opts.ambiguityMargin ?? 0.2;
  const ranked = scoreCandidates(expected, candidates);

  if (ranked.length === 0) {
    return { verdict: 'no_match', ranked: [], reason: 'No candidates supplied.' };
  }
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (top.score < threshold) {
    return {
      verdict: 'no_match',
      ranked,
      top,
      runnerUp,
      reason: `Top score ${top.score.toFixed(2)} < threshold ${threshold}.`,
    };
  }

  if (runnerUp && top.score - runnerUp.score < margin) {
    return {
      verdict: 'ambiguous',
      ranked,
      top,
      runnerUp,
      reason: `Top ${top.score.toFixed(2)} vs #2 ${runnerUp.score.toFixed(2)} within margin ${margin}.`,
    };
  }

  return {
    verdict: 'confident',
    ranked,
    top,
    runnerUp,
    reason: `Top ${top.score.toFixed(2)} clears threshold with gap ${
      runnerUp ? (top.score - runnerUp.score).toFixed(2) : 'n/a'
    }.`,
  };
}
