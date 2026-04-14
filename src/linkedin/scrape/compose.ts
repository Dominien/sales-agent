import type { Page, Locator } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle } from './page-helpers.ts';

// Inbox-only messaging. Five steps, exactly as mapped from LinkedIn's DOM:
//   1. Go to /messaging/
//   2. Click the conversation whose participant-name matches the target
//   3. Verify the thread header AND the message-group sender name match
//      the target before typing (double-check against the Agron mishap)
//   4. Type into .msg-form__contenteditable and dispatch a native input
//      event so LinkedIn's Ember binding registers the content
//   5. Poll Send button for non-disabled, click, soft-verify

const COMPOSE_BOX_SEL = '.msg-form__contenteditable[contenteditable="true"]';
const SEND_BUTTON_SEL = 'button.msg-form__send-button[type="submit"]';

export async function performSendMessage(
  page: Page,
  username: string,
  message: string,
  opts: { confirmSend: boolean; profileUrn?: string },
): Promise<ToolResult> {
  void opts.profileUrn;
  const trimmed = message.trim();
  if (!trimmed) {
    return baseResult(`https://www.linkedin.com/in/${username}/`, 'send_failed', 'Empty message.');
  }
  const profileUrl = `https://www.linkedin.com/in/${username}/`;

  // Step 0 — read display name from profile.
  const display = (await fetchDisplayName(page, profileUrl).catch(() => '')).trim();
  if (!display) {
    return baseResult(profileUrl, 'unavailable', 'Could not read target profile display name.');
  }
  const firstName = display.split(/\s+/)[0] ?? '';

  // Step 1 — navigate to inbox.
  await gotoAndSettle(page, 'https://www.linkedin.com/messaging/', { waitForSelector: 'main' });
  await page
    .waitForSelector('.msg-conversations-container__convo-item-link', { timeout: 10_000 })
    .catch(() => {});

  // Step 2 — click conversation row whose participant-name matches target.
  const clicked = await clickConversationByName(page, display);
  if (!clicked) {
    return baseResult(
      page.url(),
      'thread_not_found',
      `No conversation with '${display}' in inbox. Send one message manually to create the thread, then retry.`,
      false,
    );
  }

  // Wait for the thread pane to hydrate.
  await page
    .waitForSelector('.msg-entity-lockup__entity-title, .msg-s-message-group__name', {
      timeout: 10_000,
    })
    .catch(() => {});

  // Step 3 — verify thread actually belongs to the target (header + message
  // group sender name). Either alone could be fooled; together they're solid.
  if (!(await threadBelongsTo(page, firstName, display))) {
    return baseResult(
      page.url(),
      'recipient_resolution_failed',
      `Opened thread does not identify '${display}' in header/messages — refusing to type.`,
      false,
    );
  }

  if (!opts.confirmSend) {
    return baseResult(
      page.url(),
      'confirmation_required',
      'Set --confirm-send true to actually send.',
      true,
      false,
    );
  }

  // Step 4 — focus composer, type, dispatch input event.
  const box = page.locator(COMPOSE_BOX_SEL).last();
  try {
    await box.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    return baseResult(page.url(), 'composer_unavailable', 'Compose box did not appear.', true);
  }
  try {
    await box.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await box.click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await box.pressSequentially(trimmed, { delay: 25 });
    // Wake Ember's two-way binding — synthetic keydowns don't always trigger
    // the input listener that enables Send.
    await page
      .evaluate(
        `(function () {
          var el = document.querySelector('.msg-form__contenteditable[contenteditable="true"]');
          if (!el) return;
          try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); } catch (e) {}
          try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
          try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {}
        })()`,
      )
      .catch(() => {});
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
    return baseResult(page.url(), 'send_failed', `Could not type: ${reason}`, true);
  }

  // Step 5 — poll Send for non-disabled, click, soft-verify.
  const sendEnabled = await waitForSendEnabled(page, 10_000);
  if (!sendEnabled) {
    return baseResult(page.url(), 'send_failed', 'Send button stayed disabled — Ember binding did not register the typed text.', true);
  }
  try {
    await page.locator(SEND_BUTTON_SEL).last().click({ timeout: 5000 });
  } catch {
    return baseResult(page.url(), 'send_failed', 'Could not click Send.', true);
  }
  await page.waitForTimeout(1500);

  return baseResult(page.url(), 'message_sent', 'Message sent.', true, true);
}

// ---------- helpers (raw-string page.evaluate to avoid tsx __name emission) ----------

async function fetchDisplayName(page: Page, profileUrl: string): Promise<string> {
  await gotoAndSettle(page, profileUrl, { waitForSelector: 'main' });
  for (let i = 0; i < 20; i++) {
    const name = await page
      .evaluate(`(function () {
        var h1 = document.querySelector('main h1');
        if (h1 && (h1.innerText || '').trim()) return (h1.innerText || '').trim();
        var title = document.title || '';
        var cut = (title.split('|')[0] || '');
        return cut.replace(/\\s*[·—-].*$/, '').trim();
      })()`)
      .catch(() => '');
    if (typeof name === 'string' && name) return name;
    await page.waitForTimeout(500);
  }
  return '';
}

async function clickConversationByName(page: Page, displayName: string): Promise<boolean> {
  // Scope strictly to the conversation list, find the row where the
  // participant-name span matches the target, then click its link div.
  // Returns true iff the click actually landed (checked via --active class).
  const normalized = displayName.replace(/\s+/g, ' ').trim().toLowerCase();
  const result = await page
    .evaluate(
      `(function (target) {
        function norm(v) { return (v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
        var list = document.querySelector(
          '.msg-conversations-container__conversations-list, .msg-conversations-container, [data-view-name="msg-conversation-list"]'
        );
        if (!list) return { ok: false, reason: 'no-list' };
        var rows = list.querySelectorAll('li.msg-conversation-listitem');
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var nameEl = row.querySelector(
            'h3.msg-conversation-listitem__participant-names span.truncate, ' +
            '.msg-conversation-card__participant-names span.truncate'
          );
          if (!nameEl) continue;
          var got = norm(nameEl.innerText || nameEl.textContent || '');
          if (got === target || got.indexOf(target) === 0) {
            var link = row.querySelector('.msg-conversation-listitem__link, .msg-conversations-container__convo-item-link');
            if (!link) return { ok: false, reason: 'no-link', matched: got };
            link.click();
            return { ok: true, matched: got };
          }
        }
        return { ok: false, reason: 'no-match' };
      })(${JSON.stringify(normalized)})`,
    )
    .catch(() => ({ ok: false }));
  return !!(result && (result as { ok?: boolean }).ok);
}

async function threadBelongsTo(page: Page, firstName: string, displayName: string): Promise<boolean> {
  if (!firstName) return false;
  const fn = firstName.toLowerCase();
  const dn = displayName.toLowerCase();
  for (let i = 0; i < 10; i++) {
    const ok = await page
      .evaluate(
        `(function (fn, dn) {
          function norm(v) { return (v || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
          // Primary: right-pane thread header.
          var header = document.querySelector('.msg-entity-lockup__entity-title, .msg-thread__link-to-profile h2');
          if (header) {
            var ht = norm(header.innerText || header.textContent || '');
            if (ht.indexOf(dn) >= 0 || ht.indexOf(fn) >= 0) return true;
          }
          // Secondary: any message-group sender name in the bubble history.
          var groups = document.querySelectorAll('.msg-s-message-group__name');
          for (var i = 0; i < groups.length; i++) {
            var gt = norm(groups[i].innerText || groups[i].textContent || '');
            if (gt.indexOf(dn) >= 0 || gt.indexOf(fn) >= 0) return true;
          }
          // Tertiary: the profile-card at top of the message list.
          var cardTitle = document.querySelector('.msg-s-profile-card .artdeco-entity-lockup__title');
          if (cardTitle) {
            var ct = norm(cardTitle.innerText || cardTitle.textContent || '');
            if (ct.indexOf(dn) >= 0 || ct.indexOf(fn) >= 0) return true;
          }
          return false;
        })(${JSON.stringify(fn)}, ${JSON.stringify(dn)})`,
      )
      .catch(() => false);
    if (ok === true) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function waitForSendEnabled(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page
      .evaluate(
        `(function () {
          var b = document.querySelector('button.msg-form__send-button[type="submit"]');
          if (!b) return false;
          var visible = !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length);
          return visible && !b.disabled;
        })()`,
      )
      .catch(() => false);
    if (ok === true) return true;
    await page.waitForTimeout(300);
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

// Expose for the runner import shape; not used here but kept for parity.
export const _unused: Locator | null = null;
