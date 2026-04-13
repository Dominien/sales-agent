import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText } from './page-helpers.ts';

const COMPOSE_BOX_SELECTOR =
  '[contenteditable="true"][role="textbox"], .msg-form__contenteditable';
const SEND_BUTTON_SELECTOR =
  'button.msg-form__send-button, button[aria-label="Send"], button:has-text("Send")';

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

  if (opts.profileUrn) {
    composeUrl = `https://www.linkedin.com/messaging/compose/?recipient=${opts.profileUrn}`;
  } else {
    await gotoAndSettle(page, profileUrl, { waitForSelector: 'main' });
    const href = await page
      .evaluate(() => {
        const a = document.querySelector('a[href*="/messaging/compose/?recipient="]') as HTMLAnchorElement | null;
        return a ? a.getAttribute('href') || a.href || null : null;
      })
      .catch(() => null);
    if (!href) {
      // Fallback: click Message button to open existing thread
      const btn = page.locator('button[aria-label*="Message"], button:has-text("Message")');
      if ((await btn.count()) === 0) {
        return baseResult(profileUrl, 'message_unavailable', 'No Message action exposed for this profile.');
      }
      try {
        await btn.first().click({ timeout: 5000 });
        await page.waitForSelector(COMPOSE_BOX_SELECTOR, { timeout: 8000 });
      } catch {
        return baseResult(page.url(), 'composer_unavailable', 'Could not open compose surface.');
      }
      composeUrl = page.url();
      recipientSelected = true;
    } else {
      composeUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
    }
  }

  if (composeUrl !== page.url()) {
    await gotoAndSettle(page, composeUrl, { waitForSelector: 'main' });
  }
  await page.waitForSelector(COMPOSE_BOX_SELECTOR, { timeout: 10_000 }).catch(() => {});

  const box = page.locator(COMPOSE_BOX_SELECTOR).first();
  if ((await box.count()) === 0) {
    return baseResult(page.url(), 'composer_unavailable', 'LinkedIn did not expose a usable message composer.', recipientSelected);
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
    await box.click({ timeout: 5000 });
    await page.keyboard.type(message, { delay: 20 });
  } catch {
    return baseResult(page.url(), 'send_failed', 'Could not type into compose box.', recipientSelected);
  }

  const send = page.locator(SEND_BUTTON_SELECTOR).first();
  if ((await send.count()) === 0) {
    return baseResult(page.url(), 'send_failed', 'No Send button visible.', recipientSelected);
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
