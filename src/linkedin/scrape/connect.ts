import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText } from './page-helpers.ts';

// Ported from linkedin-mcp-server (Python) — same state-machine + structural
// dialog handling. See: src/linkedin-mcp-server/linkedin_mcp_server/
// scraping/{connection.py, extractor.py} for the reference implementation.

// The LinkedIn invite modal may or may not carry aria-modal="true" across
// builds. Match any of: the standard dialog roles, the .artdeco-modal
// wrapper, or the native <dialog open> element. We then filter to the
// invite-relevant one by looking for a Send/note/Cancel button inside.
const DIALOG_SELECTOR = '[role="dialog"], .artdeco-modal, dialog[open]';
const DIALOG_TEXTAREA_SELECTOR = '[role="dialog"] textarea, .artdeco-modal textarea, dialog[open] textarea';
const INVITE_DIALOG_MARKERS = [
  'button[aria-label*="Send" i]',
  'button[aria-label*="senden" i]',
  'button[aria-label*="Add a note" i]',
  'button[aria-label*="Notiz" i]',
  'button:has-text("Send without a note")',
  'button:has-text("Ohne Notiz senden")',
];

type ConnectionState =
  | 'already_connected'
  | 'pending'
  | 'incoming_request'
  | 'connectable'
  | 'follow_only'
  | 'unavailable';

type Locale = 'en' | 'de' | 'fr';

const STATE_BUTTON_LABEL: Record<Locale, Partial<Record<ConnectionState, string>>> = {
  en: { connectable: 'Connect', incoming_request: 'Accept' },
  de: { connectable: 'Vernetzen', incoming_request: 'Annehmen' },
  fr: { connectable: 'Se connecter', incoming_request: 'Accepter' },
};

const DETECTION_LABELS: Record<Locale, Partial<Record<ConnectionState, string>>> = {
  en: { pending: 'Pending', incoming_request: 'Accept', connectable: 'Connect', follow_only: 'Follow' },
  de: { pending: 'Ausstehend', incoming_request: 'Annehmen', connectable: 'Vernetzen', follow_only: 'Folgen' },
  fr: { pending: 'En attente', incoming_request: 'Accepter', connectable: 'Se connecter', follow_only: 'Suivre' },
};

const INCOMING_SECONDARY: Record<Locale, string> = {
  en: 'Ignore',
  de: 'Ignorieren',
  fr: 'Ignorer',
};

const FIRST_DEGREE_MARKERS = ['\u00b7 1st', '\u00b7 1.', '\u00b7 1er'];

const MORE_ARIA_LABELS = ['More', 'Mehr', 'Plus'];

const SECTION_HEADINGS: string[] = [
  // English
  'About', 'Highlights', 'Featured', 'Activity', 'Experience', 'Education',
  // German
  'Info', 'Im Fokus', 'Aktivitäten', 'Erfahrung', 'Ausbildung', 'Empfohlen',
  // French
  'Infos', 'Sélection', 'Activité', 'Expérience', 'Formation',
];

const ACTION_AREA_END = new RegExp(
  `^(?:${SECTION_HEADINGS.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\n`,
  'm',
);

function extractActionArea(profileText: string): string {
  const match = ACTION_AREA_END.exec(profileText);
  if (match) return profileText.slice(0, match.index);
  return profileText.slice(0, 500);
}

function containsStandaloneLine(area: string, label: string): boolean {
  return area.includes(`\n${label}\n`) || area.endsWith(`\n${label}`);
}

function detectConnectionState(profileText: string): { state: ConnectionState; locale: Locale } {
  const top = profileText.slice(0, 300);
  if (FIRST_DEGREE_MARKERS.some((m) => top.includes(m))) {
    return { state: 'already_connected', locale: 'en' };
  }

  const action = extractActionArea(profileText);
  for (const locale of Object.keys(DETECTION_LABELS) as Locale[]) {
    const labels = DETECTION_LABELS[locale];
    if (labels.pending && containsStandaloneLine(action, labels.pending)) {
      return { state: 'pending', locale };
    }
    if (
      labels.incoming_request &&
      containsStandaloneLine(action, labels.incoming_request) &&
      containsStandaloneLine(action, INCOMING_SECONDARY[locale])
    ) {
      return { state: 'incoming_request', locale };
    }
    if (labels.connectable && containsStandaloneLine(action, labels.connectable)) {
      return { state: 'connectable', locale };
    }
    if (labels.follow_only && containsStandaloneLine(action, labels.follow_only)) {
      return { state: 'follow_only', locale };
    }
  }
  return { state: 'unavailable', locale: 'en' };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickButtonByText(
  page: Page,
  text: string,
  opts: { scope?: string; timeoutMs?: number; isConnectAction?: boolean } = {},
): Promise<boolean> {
  const scope = opts.scope ?? 'main';
  const timeout = opts.timeoutMs ?? 5000;

  // For the Connect action specifically, prefer the profile-level action
  // whose aria-label matches "Invite <name> to connect" / "...vernetzen" /
  // "...se connecter". Sidebar "People you may know" Connects don't carry
  // this aria pattern — so this lock prevents accidentally inviting a
  // sidebar recommendation when the target's profile is in creator-mode
  // and its Connect is rendered late in DOM.
  if (opts.isConnectAction) {
    const ariaTarget = page
      .locator(scope)
      .locator('a, button, [role="button"]')
      .filter({
        has: page.locator(
          '[aria-label*="to connect" i], [aria-label*="vernetzen" i], [aria-label*="se connecter" i]',
        ),
      });
    // Combine with the element itself (the aria may live on the element, not a child).
    const ariaSelf = page
      .locator(scope)
      .locator(
        'a[aria-label*="to connect" i], a[aria-label*="vernetzen" i], a[aria-label*="se connecter" i], ' +
          'button[aria-label*="to connect" i], button[aria-label*="vernetzen" i], button[aria-label*="se connecter" i]',
      );
    for (const loc of [ariaSelf, ariaTarget]) {
      if ((await loc.count()) > 0) {
        try {
          await loc.first().scrollIntoViewIfNeeded({ timeout }).catch(() => {});
          await loc.first().click({ timeout });
          return true;
        } catch {
          // try text fallback
        }
      }
    }
  }

  // Text fallback: exact-match regex on visible button/anchor/role=button text.
  const matches = page
    .locator(scope)
    .locator('button, a, [role="button"]')
    .filter({ hasText: new RegExp(`^${escapeRegex(text)}$`, 'i') });
  if ((await matches.count()) === 0) return false;
  const target = matches.first();
  try {
    await target.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await target.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

function inviteDialogLocator(page: Page) {
  // Find the dialog that actually owns invite-related buttons.
  // Filters out hidden video-player / captions modals that live in post content.
  return page
    .locator(DIALOG_SELECTOR)
    .filter({
      has: page.locator(INVITE_DIALOG_MARKERS.join(', ')),
    })
    .first();
}

async function dialogIsOpen(page: Page, timeoutMs = 1000): Promise<boolean> {
  const loc = inviteDialogLocator(page);
  try {
    if ((await loc.count()) === 0) return false;
    await loc.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function clickDialogPrimaryButton(page: Page, timeoutMs = 5000): Promise<boolean> {
  // The invite popup structure is stable across builds:
  //   [Add a note (secondary)]  [Send without a note (primary)]
  // When the note quota is exhausted LinkedIn still shows this same pair.
  // We pick the button by its aria-label exactly matching "Send without a
  // note" / "Send now" / "Send" — order of preference ensures we NEVER hit
  // "Add a note" (which doesn't send) or "Upgrade to Premium" (closes dialog).
  const dialog = inviteDialogLocator(page);
  if ((await dialog.count()) === 0) return false;

  const buttons = dialog.locator('button, a, [role="button"]');
  const btnCount = await buttons.count();
  // Always log candidates — this is the most opaque step to debug.
  for (let i = 0; i < btnCount; i++) {
    const t = (await buttons.nth(i).innerText().catch(() => '')).trim().slice(0, 80);
    const a = (await buttons.nth(i).getAttribute('aria-label').catch(() => '')) ?? '';
    process.stderr.write(`[dialog-btn ${i}] text="${t}" aria="${a}"\n`);
  }

  // Aria-label preferences — most specific first.
  const ariaPrefs: RegExp[] = [
    /^send without a? ?note$/i,
    /^ohne notiz senden$/i,
    /^envoyer sans note$/i,
    /^send now$/i,
    /^jetzt senden$/i,
    /^send invitation$/i,
    /^einladung senden$/i,
    /^send$/i,
    /^senden$/i,
    /^envoyer$/i,
  ];
  for (const re of ariaPrefs) {
    for (let i = 0; i < btnCount; i++) {
      const aria = (await buttons.nth(i).getAttribute('aria-label').catch(() => '')) ?? '';
      if (re.test(aria)) {
        try {
          process.stderr.write(`[dialog-click] aria="${aria}" idx=${i}\n`);
          await buttons.nth(i).click({ timeout: timeoutMs });
          return true;
        } catch {
          break;
        }
      }
    }
  }

  // Visible text preferences — same list, applied to button innerText.
  for (const re of ariaPrefs) {
    for (let i = 0; i < btnCount; i++) {
      const t = (await buttons.nth(i).innerText().catch(() => '')).trim();
      if (re.test(t)) {
        try {
          process.stderr.write(`[dialog-click] text="${t}" idx=${i}\n`);
          await buttons.nth(i).click({ timeout: timeoutMs });
          return true;
        } catch {
          break;
        }
      }
    }
  }

  // Fallback: click LinkedIn's primary style (artdeco-button--primary) first.
  const primary = dialog.locator('button.artdeco-button--primary:not([disabled])');
  if ((await primary.count()) > 0) {
    try {
      process.stderr.write(`[dialog-click] artdeco-button--primary\n`);
      await primary.first().click({ timeout: timeoutMs });
      return true;
    } catch {
      // continue
    }
  }

  // Last-resort fallback: last interactive element (Daniel's original heuristic).
  if (btnCount === 0) return false;
  try {
    process.stderr.write(`[dialog-click] nth(${btnCount - 1}) last-button fallback\n`);
    await buttons.nth(btnCount - 1).click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function fillDialogTextarea(page: Page, value: string, timeoutMs = 5000): Promise<boolean> {
  const ta = page.locator(DIALOG_TEXTAREA_SELECTOR);
  try {
    if ((await ta.count()) === 0) return false;
    await ta.first().fill(value, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function dismissDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page
    .waitForSelector(DIALOG_SELECTOR, { state: 'hidden', timeout: 3000 })
    .catch(() => {});
}

async function openMoreMenu(page: Page): Promise<boolean> {
  const sel = MORE_ARIA_LABELS.map((a) => `main button[aria-label*="${a}"]`).join(', ');
  const more = page.locator(sel);
  try {
    if ((await more.count()) === 0) return false;
    await more.first().click({ timeout: 5000 });
  } catch {
    return false;
  }
  try {
    await page.waitForSelector('[role="menu"]', { timeout: 3000 });
  } catch {
    return false;
  }
  // Only report success if the menu actually contains a Connect-equivalent.
  const connectLabels = Object.values(STATE_BUTTON_LABEL)
    .map((m) => m.connectable)
    .filter((v): v is string => Boolean(v));
  const re = new RegExp(`^(?:${connectLabels.map(escapeRegex).join('|')})$`);
  const items = page
    .locator('[role="menu"]')
    .locator('button, a, li, [role="menuitem"], [role="button"]')
    .filter({ hasText: re });
  return (await items.count()) > 0;
}

export async function performConnect(
  page: Page,
  username: string,
  note: string | undefined,
): Promise<ToolResult> {
  const url = `https://www.linkedin.com/in/${username}/`;
  await gotoAndSettle(page, url, { waitForSelector: 'main' });
  // Wait for the action row (or any meaningful main content) to hydrate.
  await page
    .waitForFunction(
      () => (document.querySelector('main') as HTMLElement | null)?.innerText.length ?? 0 > 100,
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});

  const profileText = await readMainText(page);
  if (!profileText) {
    return result(url, 'unavailable', 'Could not read profile page.');
  }

  let { state, locale } = detectConnectionState(profileText);

  if (state === 'already_connected') {
    return result(url, 'already_connected', 'You are already connected with this profile.');
  }
  if (state === 'pending') {
    return result(url, 'pending', 'A connection request is already pending for this profile.');
  }

  let viaMoreMenu = false;
  if (state === 'follow_only') {
    if (await openMoreMenu(page)) {
      state = 'connectable';
      viaMoreMenu = true;
    } else {
      return result(url, 'follow_only', 'This profile currently exposes Follow but not Connect.');
    }
  }

  if (state === 'unavailable') {
    return result(url, 'connect_unavailable', 'LinkedIn did not expose a usable Connect action for this profile.');
  }

  // connectable or incoming_request
  const buttonText = STATE_BUTTON_LABEL[locale]?.[state];
  if (!buttonText) {
    return result(url, 'connect_unavailable', `No button mapping for state '${state}' (locale '${locale}').`);
  }

  const clickScope = viaMoreMenu ? '[role="menu"]' : 'main';
  const clicked = await clickButtonByText(page, buttonText, {
    scope: clickScope,
    isConnectAction: state === 'connectable',
  });
  if (!clicked) {
    return result(url, 'send_failed', `Could not find or click button '${buttonText}'.`);
  }

  // Wait for a dialog — only for connect flow; Accept typically has none.
  if (state === 'connectable') {
    try {
      await page.waitForSelector(DIALOG_SELECTOR, { timeout: 4000 });
    } catch {
      // continue; invite may have been sent without a dialog
    }
    // Sanity check: the dialog should reference the target profile. If the
    // click landed on a sidebar "People you may know" Connect (wrong target),
    // the dialog header will name someone else — bail rather than sending.
    const targetName = (profileText.split('\n')[0] ?? '').trim();
    if (targetName && (await dialogIsOpen(page))) {
      const dialogText = await page
        .locator(DIALOG_SELECTOR)
        .first()
        .innerText({ timeout: 2000 })
        .catch(() => '');
      const firstName = targetName.split(/\s+/)[0];
      if (firstName && firstName.length >= 3 && !dialogText.includes(firstName)) {
        await dismissDialog(page);
        return result(
          url,
          'send_failed',
          `Opened a dialog that did not reference '${firstName}' — likely wrong Connect button (sidebar recommendation). Aborted.`,
        );
      }
    }
  }

  let noteSent = false;
  if (note && (await dialogIsOpen(page))) {
    if (note.length > 300) {
      await dismissDialog(page);
      return result(url, 'send_failed', `Note is ${note.length} chars; LinkedIn limit is 300.`);
    }
    // Reveal textarea: click first dialog button ("Add a note") if textarea absent.
    const taCount = await page.locator(DIALOG_TEXTAREA_SELECTOR).count();
    if (taCount === 0) {
      const buttons = page.locator(`${DIALOG_SELECTOR} button, ${DIALOG_SELECTOR} [role="button"]`);
      if ((await buttons.count()) > 1) {
        await buttons.first().click({ timeout: 3000 }).catch(() => {});
      }
    }
    const filled = await fillDialogTextarea(page, note);
    if (filled) {
      noteSent = true;
    } else {
      // Note UI unavailable (free-tier quota exhausted) — proceed to bare send
      // per CLAUDE.md fallback rule.
    }
  }

  if (await dialogIsOpen(page)) {
    const sent = await clickDialogPrimaryButton(page);
    if (!sent) {
      await dismissDialog(page);
      return result(url, 'send_failed', 'Could not find the send button in the dialog.');
    }
    // Hard-require the invite dialog to close. If it stays open, our click
    // did not land (e.g. invisible target, overlay interception). Do NOT
    // report success on a still-open dialog.
    let dialogClosed = false;
    for (let i = 0; i < 12 && !dialogClosed; i++) {
      await page.waitForTimeout(500).catch(() => {});
      const stillOpen = await inviteDialogLocator(page)
        .isVisible({ timeout: 500 })
        .catch(() => false);
      dialogClosed = !stillOpen;
    }
    if (!dialogClosed) {
      await dismissDialog(page);
      return result(
        url,
        'send_failed',
        'Clicked Send but the invite dialog did not close — click was ineffective.',
        noteSent,
      );
    }
  }

  // Verify: re-read the action area (cut at section headings like About /
  // Info / Activity) and confirm LinkedIn now shows Pending. Slicing first
  // 600 chars was too loose — "Pending" can appear in post content or
  // sidebar notifications. Re-parse using detectConnectionState for parity
  // with Daniel's reference.
  if (state === 'connectable') {
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      await page.waitForTimeout(500).catch(() => {});
      const postText = await readMainText(page);
      const redetected = detectConnectionState(postText);
      ok = redetected.state === 'pending' || redetected.state === 'already_connected';
    }
    if (!ok) {
      return result(
        url,
        'send_failed',
        'Dialog closed but action area did not enter Pending — invite silently rejected by LinkedIn (possible upsell modal or account-level throttle).',
        noteSent,
      );
    }
  }

  const status = state === 'incoming_request' ? 'accepted' : 'connected';
  return result(
    url,
    status,
    status === 'connected' ? 'Connection request sent.' : 'Incoming connection accepted.',
    noteSent,
  );
}

function result(url: string, status: string, message: string, noteSent = false): ToolResult {
  return {
    url,
    sections: { connect: message },
    status,
    message,
    note_sent: noteSent,
  };
}
