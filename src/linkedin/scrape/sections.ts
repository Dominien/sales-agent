/** Section name → [url suffix, is overlay] */
export const PERSON_SECTIONS: Record<string, { suffix: string; overlay: boolean }> = {
  main_profile: { suffix: '/', overlay: false },
  experience: { suffix: '/details/experience/', overlay: false },
  education: { suffix: '/details/education/', overlay: false },
  interests: { suffix: '/details/interests/', overlay: false },
  honors: { suffix: '/details/honors/', overlay: false },
  languages: { suffix: '/details/languages/', overlay: false },
  certifications: { suffix: '/details/certifications/', overlay: false },
  contact_info: { suffix: '/overlay/contact-info/', overlay: true },
  posts: { suffix: '/recent-activity/all/', overlay: false },
};

export const COMPANY_SECTIONS: Record<string, { suffix: string; overlay: boolean }> = {
  about: { suffix: '/about/', overlay: false },
  posts: { suffix: '/posts/', overlay: false },
  jobs: { suffix: '/jobs/', overlay: false },
};

export function parsePersonSections(input?: string): { requested: string[]; unknown: string[] } {
  const requested = new Set<string>(['main_profile']);
  const unknown: string[] = [];
  if (!input) return { requested: Array.from(requested), unknown };
  for (const raw of input.split(',')) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (PERSON_SECTIONS[name]) requested.add(name);
    else unknown.push(name);
  }
  return { requested: Array.from(requested), unknown };
}

export function parseCompanySections(input?: string): { requested: string[]; unknown: string[] } {
  const requested = new Set<string>(['about']);
  const unknown: string[] = [];
  if (!input) return { requested: Array.from(requested), unknown };
  for (const raw of input.split(',')) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (COMPANY_SECTIONS[name]) requested.add(name);
    else unknown.push(name);
  }
  return { requested: Array.from(requested), unknown };
}
