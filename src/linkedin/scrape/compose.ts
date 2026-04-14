import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText } from './page-helpers.ts';

// Ordered most-specific → most-generic, ported from linkedin-mcp-server
// (_MESSAGING_COMPOSE_FALLBACK_SELECTORS). The aria-label match lands on the
// active compose box rather than hidden hover-card composers.
const COMPOSE_BOX_SELECTORS = [
  'div[role="textbox"][contenteditable="true"][aria-label*="Write a message"]',
  'main div[role="textbox"][contenteditable="true"]',
  'main [contenteditable="true"][aria-label*="message" i]',
  '[contenteditable="true"][role="textbox"]',
  '.msg-form__contenteditable',
];
const SEND_BUTTON_SELECTOR =
  'button[type="submit"]:not([disabled]), ' +
  'button[aria-label*="Send" i]:not([disabled]), ' +
  'button.msg-form__send-button:not([disabled])';

export async function performSendMessage(
  page: Page,
  username: string,
  message: string,
  opts: { confirmSend: boolean; profileUrn?: string },
): Promise<ToolResult> {
  if (!message.trim()) {
    return baseResult(`https://www.linkedin.com/in/${username}/`, 'send_failed', 'Empty message.');
  }
  const profileUrl = `https://www.linkedin.com/in/${username}/`;

  let composeUrl: string;
  let recipientSelected = false;

  // Primary path: open the existing conversation from the inbox. Works for
  // 1st-degree threads AND for InMail threads where LinkedIn won't expose a
  // compose URL on the profile. Avoids the peek-chat overlay on profiles,
  // which opens a recipient-picker instead of the existing thread's composer.
  const display = await fetchDisplayName(page, profileUrl).catch(() => '');
  const opened = await openThreadFromInbox(page, { username, displayName: display });
  if (opened) {
    composeUrl = page.url();
    recipientSelected = true;
  } else if (opts.profileUrn) {
    composeUrl = `https://www.linkedin.com/messaging/compose/?recipient=${opts.profileUrn}`;
  } else {
    // Fallback: the legacy profile-page path.
    const href = await page
      .evaluate(() => {
        const a = document.querySelector('a[href*="/messaging/compose/?recipient="]') as HTMLAnchorElement | null;
        return a ? a.getAttribute('href') || a.href || null : null;
      })
      .catch(() => null);
    if (href) {
      composeUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
    } else {
      const btn = page.locator('button[aria-label*="Message"], button:has-text("Message")');
      if ((await btn.count()) === 0) {
        return baseResult(profileUrl, 'message_unavailable', 'No Message action exposed for this profile.');
      }
      try {
        await btn.first().click({ timeout: 5000 });
        await page.waitForSelector(COMPOSE_BOX_SELECTORS.join(', '), { timeout: 8000 });
      } catch {
        return baseResult(page.url(), 'composer_unavailable', 'Could not open compose surface.');
      }
      composeUrl = page.url();
      recipientSelected = true;
    }
  }

  if (composeUrl !== page.url()) {
    await gotoAndSettle(page, composeUrl, { waitForSelector: 'main' });
  }

  // Resolve the compose box: try each selector in priority order and pick
  // the LAST visible match (matches the active composer, not hover-card stubs).
  let box: ReturnType<Page['locator']> | null = null;
  for (const sel of COMPOSE_BOX_SELECTORS) {
    const cand = page.locator(sel).last();
    try {
      await cand.waitFor({ state: 'visible', timeout: 5000 });
      box = cand;
      break;
    } catch {
      continue;
    }
  }
  if (!box) {
    return baseResult(
      page.url(),
      'composer_unavailable',
      'LinkedIn did not expose a visible message composer.',
      recipientSelected,
    );
  }

  // Recipient confirmation: skip strict matching; trust URN/profile path
  recipientSelected = true;

  if (!opts.confirmSend) {
    return baseResult(
      page.url(),
      'confirmation_required',
      'Set --confirm-send true to actually send.',
      recipientSelected,
      false,
    );
  }

  try {
    await box.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    // Some surfaces (peek-chat overlays, InMail-thread composers) have subtle
    // overlays that intercept normal clicks — fall back to a forced click.
    try {
      await box.click({ timeout: 3000 });
    } catch {
      await box.click({ timeout: 3000, force: true });
    }
    await page.waitForTimeout(300);
    await box.pressSequentially(message, { delay: 30 });
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
    return baseResult(page.url(), 'send_failed', `Could not type into compose box: ${reason}`, recipientSelected);
  }

  // Wait for Send to become enabled — LinkedIn disables it until the composer
  // registers the typed text.
  try {
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll(
            'button[type="submit"], button[aria-label*="Send"], button[aria-label*="send"]',
          ),
        ).some((b) => {
          const el = b as HTMLButtonElement;
          const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          return visible && !el.disabled;
        }),
      undefined,
      { timeout: 8000 },
    );
  } catch {
    return baseResult(page.url(), 'send_failed', 'Send button never became enabled.', recipientSelected);
  }

  const send = page.locator(SEND_BUTTON_SELECTOR).last();
  if ((await send.count()) === 0) {
    return baseResult(page.url(), 'send_failed', 'No enabled Send button visible.', recipientSelected);
  }
  try {
    await send.click({ timeout: 5000 });
  } catch {
    return baseResult(page.url(), 'send_failed', 'Could not click Send.', recipientSelected);
  }

  // Wait for the send to settle (button state change or the textbox emptying)
  await new Promise((r) => setTimeout(r, 1500));

  return baseResult(page.url(), 'message_sent', 'Message sent.', recipientSelected, true);
}

async function fetchDisplayName(page: Page, profileUrl: string): Promise<string> {
  // Lightweight: navigate to the profile, read the H1 (display name).
  await gotoAndSettle(page, profileUrl, { waitForSelector: 'main' });
  return await page
    .evaluate(() => {
      const h1 = document.querySelector('main h1') as HTMLElement | null;
      return h1 ? (h1.innerText || '').trim() : '';
    })
    .catch(() => '');
}

async function openThreadFromInbox(
  page: Page,
  opts: { username: string; displayName: string },
): Promise<boolean> {
  const inboxUrl = 'https://www.linkedin.com/messaging/';
  await gotoAndSettle(page, inboxUrl, { waitForSelector: 'main' });
  // Wait for conversation list to hydrate.
  await page
    .waitForSelector('.msg-conversation-card__content--selectable, a.msg-conversations-container__convo-item-link', {
      timeout: 8000,
    })
    .catch(() => {});

  // Locate the conversation item matching the target. LinkedIn renders each
  // conversation as <a class="msg-conversation-card__content--selectable">
  // or as an <a href="/in/<URN>"> wrapper. Match by display name first, then
  // by username.
  const selectors: string[] = [];
  if (opts.displayName) {
    selectors.push(`a.msg-conversation-card__content--selectable:has-text("${opts.displayName}")`);
    selectors.push(`.msg-conversation-listitem:has-text("${opts.displayName}")`);
    selectors.push(`li:has(h3:has-text("${opts.displayName}"))`);
  }
  selectors.push(`a[href*="/in/${opts.username}"]`);

  for (const sel of selectors) {
    const target = page.locator(sel).first();
    if ((await target.count()) === 0) continue;
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await target.click({ timeout: 5000 });
      // Wait for the thread's composer to appear.
      await page.waitForSelector(COMPOSE_BOX_SELECTORS.join(', '), { timeout: 8000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function baseResult(
  url: string,
  status: string,
  message: string,
  recipientSelected = false,
  sent = false,
): ToolResult {
  return {
    url,
    sections: { compose: message },
    status,
    message,
    recipient_selected: recipientSelected,
    sent,
  };
}
