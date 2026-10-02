// Every claude.ai DOM assumption lives here. If Claude changes its markup, fix this file.
(function (root) {
  'use strict';

  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const CHAT_RE = new RegExp('/chat/(' + UUID + ')', 'i');
  const PROJECT_RE = new RegExp('/project/(' + UUID + ')', 'i');

  // Message composer: the editable element, then the visual box around it.
  const EDITOR_SELECTORS = [
    'div[contenteditable="true"].ProseMirror',
    '[data-testid="chat-input"]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  const COMPOSER_BOX_SELECTORS = 'fieldset, form, [data-testid="chat-input-container"]';

  // Things that mean "Claude is currently generating a reply".
  const STREAMING_SELECTORS = ['[data-is-streaming="true"]'];
  const STOP_BUTTON_SELECTORS = ['button[aria-label*="stop" i]', '[data-testid="stop-button"]'];
  const STOP_EXCLUDE_RE = /sharing|recording|dictation|voice|listening/i;

  // Links to chats that are part of message content shouldn't be painted.
  const MESSAGE_CONTENT = '[data-testid="user-message"], .font-claude-message, .font-claude-response, [data-is-streaming]';
  const SIDEBAR = 'nav, aside, [data-testid*="sidebar" i]';

  function idFrom(re, str) {
    const m = re.exec(str || '');
    return m ? m[1].toLowerCase() : null;
  }
  const chatIdFromPath = (p) => idFrom(CHAT_RE, p);
  const projectIdFromPath = (p) => idFrom(PROJECT_RE, p);

  function cleanTitle(t) {
    const s = String(t || '').replace(/\s*[-|–—]\s*Claude\s*$/i, '').trim();
    return s && !/^claude$/i.test(s) ? s : '';
  }

  function currentPath() {
    const T = root.CCC_TEST;
    return (T && T.path) || root.location.pathname;
  }

  function isOurs(el) {
    return !!el.closest('[id^="ccc-"]');
  }

  function chatLinks(doc) {
    return Array.from(doc.querySelectorAll('a[href*="/chat/"]')).filter(
      (a) => chatIdFromPath(a.getAttribute('href')) && !a.closest(MESSAGE_CONTENT) && !isOurs(a)
    );
  }

  function isInSidebar(el) {
    return !!el.closest(SIDEBAR);
  }

  function composer(doc) {
    for (const sel of EDITOR_SELECTORS) {
      const el = Array.from(doc.querySelectorAll(sel)).find((e) => !isOurs(e));
      if (!el) continue;
      return el.closest(COMPOSER_BOX_SELECTORS) || (el.parentElement && el.parentElement.parentElement) || el;
    }
    return null;
  }

  function isStreaming(doc) {
    for (const sel of STREAMING_SELECTORS) if (doc.querySelector(sel)) return true;
    for (const sel of STOP_BUTTON_SELECTORS) {
      for (const b of doc.querySelectorAll(sel)) {
        const label = b.getAttribute('aria-label') || b.textContent || '';
        if (!STOP_EXCLUDE_RE.test(label) && !isOurs(b)) return true;
      }
    }
    return false;
  }

  // The project breadcrumb shown on a chat page (outside the sidebar).
  function projectIdOnPage(doc) {
    for (const a of doc.querySelectorAll('a[href*="/project/"]')) {
      if (isInSidebar(a) || isOurs(a)) continue;
      const id = projectIdFromPath(a.getAttribute('href'));
      if (id) return id;
    }
    return null;
  }

  function chatTitle(doc) {
    const fromTitle = cleanTitle(doc.title);
    if (fromTitle) return fromTitle;
    const btn = doc.querySelector('[data-testid="chat-menu-trigger"], [data-testid="chat-title-button"]');
    return btn ? cleanTitle(btn.textContent) : '';
  }

  const api = {
    CHAT_RE, PROJECT_RE,
    chatIdFromPath, projectIdFromPath, cleanTitle, currentPath,
    chatLinks, isInSidebar, composer, isStreaming, projectIdOnPage, chatTitle,
  };
  root.CCC = root.CCC || {};
  root.CCC.selectors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
