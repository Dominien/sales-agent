/**
 * Centralized DOM selectors. When LinkedIn ships UI changes, patch here.
 * Prefer stable container classes over auto-generated hashes.
 */
export const SEL = {
  // Inbox
  inboxContainer: '.msg-conversations-container, [data-test-conversation-list]',
  inboxRow: '.msg-conversations-container__convo-item, [data-test-conversation-list-item]',
  // Conversation thread
  threadContainer: '.msg-thread, .msg-overlay-conversation-bubble',
  threadMessages: '.msg-s-message-list, .msg-s-event-listitem',
  // Compose / send message
  composeButton: 'button[aria-label*="Message"], a[href*="/messaging/compose"]',
  composeBox: '.msg-form__contenteditable, [contenteditable="true"][role="textbox"]',
  composeSend: 'button.msg-form__send-button',
  // Profile
  profileTopCard: '.pv-top-card, .ph5.pb5',
  profileMainContent: 'main',
  // Connect / invite
  connectButton: 'button[aria-label*="Invite"], button:has-text("Connect")',
  followButton: 'button[aria-label*="Follow"]',
  addNoteButton: 'button[aria-label="Add a note"]',
  customMessageTextarea: 'textarea#custom-message',
  sendInviteButton: 'button[aria-label="Send invitation"], button[aria-label*="Send now"]',
  // Company
  companyTopCard: '.org-top-card, .scaffold-layout__main',
  companyPostsList: '.feed-shared-update-v2',
  // Job
  jobMainCard: '.jobs-unified-top-card, .job-details-jobs-unified-top-card',
  jobDescription: '.jobs-description, .jobs-description-content',
  // Search
  peopleSearchResults: '.reusable-search__result-container, [data-chameleon-result-urn*="member"]',
  jobSearchResults: '.jobs-search-results__list-item, [data-job-id]',
};
