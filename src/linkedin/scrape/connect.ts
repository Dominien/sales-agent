import type { Page } from 'rebrowser-playwright';
import type { ToolResult } from '../types.ts';
import { gotoAndSettle, readMainText } from './page-helpers.ts';

const DIALOG_SELECTOR = '[role="dialog"]';
const DIALOG_TEXTAREA_SELECTOR = '[role="dialog"] textarea#custom-message, [role="dialog"] textarea';

export async function performConnect(
  page: Page,
  username: string,
  note: string | undefined,
): Promise<ToolResult> {
  const url = `https://www.linkedin.com/in/${username}/`;
  await gotoAndSettle(page, url, { waitForSelector: 'main' });
  const profileText = await readMainText(page);
  if (!profileText) {
    return result(url, 'unavailable', 'Could not read profile page.');
  }

  // Look for direct Connect / Pending / Following state indicators
  const state = detectState(profileText, page);

  // Quick branch: already pending or connected
  const pending =
    /pending/i.test(profileText) &&
    (await page.locator('button:has-text("Pending")').count()) > 0;
  if (pending) {
    return result(url, 'pending', 'A connection request is already pending for this profile.');
  }

  const connectedDirect = await page
    .locator('button:has-text("Message")')
    .first()
    .isVisible()
    .catch(() => false);
  const hasConnectBtn = (await page.locator('button:has-text("Connect")').count()) > 0;
  if (connectedDirect && !hasConnectBtn) {
    return result(url, 'already_connected', 'You are already connected with this profile.');
  }

  // Find a Connect button on main; fall back to More menu
  let clicked = await tryClickConnect(page, false);
  if (!clicked) {
    if (await openMoreMenu(page)) {
      clicked = await tryClickConnect(page, true);
    }
  }
  if (!clicked) {
    if ((await page.locator('button:has-text("Follow")').count()) > 0) {
      return result(url, 'follow_only', 'This profile currently exposes Follow but not Connect.');
    }
    return result(url, 'connect_unavailable', 'No Connect action visible on this profile.');
  }

  // Wait for dialog (may not appear if Connect sends instantly)
  let dialogOpen = false;
  try {
    await page.waitForSelector(DIALOG_SELECTOR, { timeout: 4000 });
    dialogOpen = true;
  } catch {
    // continue
  }

  let noteSent = false;
  if (dialogOpen && note) {
    if (note.length > 300) {
      return result(url, 'send_failed', `Note is ${note.length} chars; LinkedIn limit is 300.`);
    }
    const textareaCount = await page.locator(DIALOG_TEXTAREA_SELECTOR).count();
    if (textareaCount === 0) {
      // Click "Add a note" button (typically the first dialog button)
      const buttons = page.locator(`${DIALOG_SELECTOR} button, ${DIALOG_SELECTOR} [role="button"]`);
      if ((await buttons.count()) > 1) {
        await buttons.first().click().catch(() => {});
      }
    }
    const ta = page.locator(DIALOG_TEXTAREA_SELECTOR).first();
    if ((await ta.count()) === 0) {
      await dismissDialog(page);
      return result(url, 'note_not_supported', 'Note entry not offered for this connection flow.');
    }
    try {
      await ta.fill(note, { timeout: 5000 });
      noteSent = true;
    } catch {
      await dismissDialog(page);
      return result(url, 'note_not_supported', 'Could not fill connection note textarea.');
    }
  }

  if (dialogOpen) {
    const sent = await clickPrimary(page);
    if (!sent) {
      await dismissDialog(page);
      return result(url, 'send_failed', 'Could not click the Send button in the dialog.');
    }
    try {
      await page.waitForSelector(DIALOG_SELECTOR, { state: 'hidden', timeout: 8000 });
    } catch {
      // continue
    }
  }

  const finalStatus = state === 'incoming_request' ? 'accepted' : 'connected';
  return result(
    url,
    finalStatus,
    finalStatus === 'connected' ? 'Connection request sent.' : 'Incoming connection accepted.',
    noteSent,
  );
}

function detectState(_text: string, _page: Page): 'connectable' | 'incoming_request' | 'unknown' {
  // Simplified: assume connectable. Incoming-request detection would require
  // looking for "Accept" button; the click flow handles both.
  return 'connectable';
}

async function tryClickConnect(page: Page, viaMenu: boolean): Promise<boolean> {
  const scope = viaMenu ? '[role="menu"]' : 'main';
  const btn = page.locator(`${scope} button:has-text("Connect"), ${scope} [role="button"]:has-text("Connect")`);
  if ((await btn.count()) === 0) return false;
  try {
    await btn.first().click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function openMoreMenu(page: Page): Promise<boolean> {
  const more = page.locator('main button[aria-label*="More actions"], main button:has-text("More")');
  if ((await more.count()) === 0) return false;
  try {
    await more.first().click({ timeout: 5000 });
    await page.waitForSelector('[role="menu"]', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function clickPrimary(page: Page): Promise<boolean> {
  const candidates = [
    `${DIALOG_SELECTOR} button:has-text("Send now")`,
    `${DIALOG_SELECTOR} button:has-text("Send")`,
    `${DIALOG_SELECTOR} button[aria-label="Send invitation"]`,
    `${DIALOG_SELECTOR} button[aria-label*="Send"]`,
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    if ((await loc.count()) > 0) {
      try {
        await loc.first().click({ timeout: 5000 });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function dismissDialog(page: Page): Promise<void> {
  await page
    .locator(`${DIALOG_SELECTOR} button[aria-label="Dismiss"], ${DIALOG_SELECTOR} button:has-text("Cancel")`)
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

function result(
  url: string,
  status: string,
  message: string,
  noteSent = false,
): ToolResult {
  return {
    url,
    sections: { connect: message },
    status,
    message,
    note_sent: noteSent,
  };
}
