/**
 * Honorific normalization for compose-time greetings.
 *
 * Legacy CRM data often stores honorifics inside the `firstname` field
 * ("Dr. Joachim", "Prof. Dr. Karin", "Dipl.-Ing. Martin"). A naive formal
 * German greeting (`Sehr geehrter Herr <firstname> <lastname>`) renders
 * doubly-honorific ("Sehr geehrter Herr Dr. Joachim Maiwald") which reads
 * wrong on both sides of the formal/casual line.
 *
 * This utility strips honorifics from `firstname`, returns them as a
 * separate field, and offers greeting builders that compose them back in
 * the correct position.
 *
 * Scope: English + German academic/professional titles. French and Italian
 * are not included because the retrospective covered only those two. Add
 * patterns here when new locales land.
 */

// Longest prefixes first so multi-token titles ("Prof. Dr.", "Dipl.-Ing.")
// consume before single tokens.
const HONORIFIC_PATTERNS: RegExp[] = [
  /^(Prof\.?\s+Dr\.?\s+med\.?\s+habil\.?)\s+/i,
  /^(Prof\.?\s+Dr\.?\s+h\.?c\.?)\s+/i,
  /^(Prof\.?\s+Dr\.?\s+med\.?)\s+/i,
  /^(Prof\.?\s+Dr\.?\s+ing\.?)\s+/i,
  /^(Prof\.?\s+Dr\.?)\s+/i,
  /^(Dr\.?\s+med\.?\s+dent\.?)\s+/i,
  /^(Dr\.?\s+med\.?\s+vet\.?)\s+/i,
  /^(Dr\.?\s+med\.?)\s+/i,
  /^(Dr\.?\s+rer\.?\s+nat\.?)\s+/i,
  /^(Dr\.?\s+phil\.?)\s+/i,
  /^(Dr\.?\s+h\.?c\.?)\s+/i,
  /^(Dipl\.-?\s?Ing\.?)\s+/i,
  /^(Dipl\.-?\s?Kfm\.?)\s+/i,
  /^(Dipl\.-?\s?Wirt\.?-?Ing\.?)\s+/i,
  /^(Dipl\.-?\s?Psych\.?)\s+/i,
  /^(Mag\.?\s+rer\.?\s+nat\.?)\s+/i,
  /^(Prof\.?)\s+/i,
  /^(Dr\.?)\s+/i,
  /^(Mag\.?)\s+/i,
  /^(Ing\.?)\s+/i,
];

const GENDERED_TITLES: Record<'de' | 'en', { male: string; female: string }> = {
  de: { male: 'Herr', female: 'Frau' },
  en: { male: 'Mr.', female: 'Ms.' },
};

export type Locale = 'en' | 'de';
export type Gender = 'male' | 'female' | 'unknown';

export interface NormalizedName {
  /** Academic/professional title, e.g. "Dr." or "Prof. Dr." (without leading/trailing spaces). Empty if none. */
  honorific: string;
  /** Cleaned first name with honorific removed. */
  firstname: string;
  lastname: string;
}

/** Split a raw firstname that may contain leading honorifics. */
export function normalizeName(input: { firstname: string; lastname: string }): NormalizedName {
  const raw = (input.firstname ?? '').trim();
  let honorific = '';
  let rest = raw;

  for (const re of HONORIFIC_PATTERNS) {
    const m = rest.match(re);
    if (m) {
      const part = m[1].trim();
      honorific = honorific ? `${honorific} ${part}` : part;
      rest = rest.slice(m[0].length).trim();
      // Keep looping in case a longer chain was present (already-ordered longest-first handles most cases).
    }
  }

  return {
    honorific,
    firstname: rest,
    lastname: (input.lastname ?? '').trim(),
  };
}

/**
 * Build a locale-appropriate formal greeting.
 *
 * German, gender known:      "Sehr geehrter Herr Dr. Maiwald,"
 * German, gender unknown:    "Sehr geehrte Damen und Herren,"
 * English, gender known:     "Dear Dr. Maiwald,"
 * English, gender unknown:   "Dear Dr. Maiwald," (title-first fallback)
 */
export function formalGreeting(
  input: { firstname: string; lastname: string; gender?: Gender },
  locale: Locale = 'en',
): string {
  const n = normalizeName(input);
  const titled = n.honorific ? `${n.honorific} ${n.lastname}` : n.lastname;
  const gender = input.gender ?? 'unknown';

  if (locale === 'de') {
    if (gender === 'male') return `Sehr geehrter Herr ${titled},`;
    if (gender === 'female') return `Sehr geehrte Frau ${titled},`;
    // Unknown gender in German: default to plural form — the only formally
    // safe option when we can't guess from the firstname. Caller can supply
    // `gender` when they know it.
    if (!n.lastname) return 'Sehr geehrte Damen und Herren,';
    // Still unsafe to guess Herr/Frau; use the title-only fallback.
    return `Sehr geehrte(r) ${titled},`;
  }

  // English
  if (n.lastname) {
    const title = gender === 'male'
      ? GENDERED_TITLES.en.male
      : gender === 'female'
        ? GENDERED_TITLES.en.female
        : '';
    const prefix = n.honorific || title;
    return prefix ? `Dear ${prefix} ${n.lastname},` : `Dear ${n.lastname},`;
  }
  return 'Dear Sir or Madam,';
}

/** Casual greeting: first name only, honorific dropped. */
export function casualGreeting(input: { firstname: string; lastname: string }): string {
  const n = normalizeName(input);
  return n.firstname ? `Hi ${n.firstname},` : 'Hi,';
}
