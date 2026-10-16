// Pure logic for the subagent inbox: one entry per finished subagent, grouped by project.
//
// Stored at chrome.storage.local["inbox"] as { <toolUseId>: entry }
//   entry: { chatId, projectId, name, task, summary, isError, finishedAt, unread }
(function (root) {
  'use strict';

  const MAX_ENTRIES = 100;
  const TASK_CHARS = 120;
  const SUMMARY_CHARS = 400;

  function clip(text, n) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  // Keep the newest MAX_ENTRIES.
  function prune(inbox) {
    const ids = Object.keys(inbox);
    if (ids.length <= MAX_ENTRIES) return inbox;
    ids.sort((a, b) => (inbox[b].finishedAt || 0) - (inbox[a].finishedAt || 0));
    const next = {};
    for (const id of ids.slice(0, MAX_ENTRIES)) next[id] = inbox[id];
    return next;
  }

  // Adds the finished subagents of one chat (output of CCC.api.extractSubagents).
  // Entries already in the inbox are left alone, so one you've read never turns unread again.
  // Returns the new inbox, or null when nothing changed.
  function add(inbox, subagents, { chatId, projectId, now }) {
    const next = { ...(inbox || {}) };
    let changed = false;
    for (const s of subagents || []) {
      if (!s || !s.id || !s.done || s.id in next) continue;
      next[s.id] = {
        chatId,
        projectId: projectId || null,
        name: s.name || 'subagent',
        task: clip(s.task, TASK_CHARS),
        summary: clip(s.summary, SUMMARY_CHARS),
        isError: !!s.isError,
        finishedAt: s.finishedAt || now,
        unread: true,
      };
      changed = true;
    }
    return changed ? prune(next) : null;
  }

  // Marks entries read: all of them, or only those where pick(entry, id) is true. Null when nothing changed.
  function markRead(inbox, pick) {
    const next = { ...(inbox || {}) };
    let changed = false;
    for (const [id, e] of Object.entries(next)) {
      if (e && e.unread && (!pick || pick(e, id))) {
        next[id] = { ...e, unread: false };
        changed = true;
      }
    }
    return changed ? next : null;
  }

  function unreadCount(inbox) {
    return Object.values(inbox || {}).filter((e) => e && e.unread).length;
  }

  // Ids in `after` that weren't in `before` and are unread (to announce them once).
  function arrivals(before, after) {
    return Object.keys(after || {}).filter((id) => !(before && id in before) && after[id] && after[id].unread);
  }

  // [{ projectId, name, unread, entries: [{ id, ...entry }] }]
  // Groups with the newest entry first; chats outside a project are grouped last.
  function groupByProject(inbox, projectNames = {}) {
    const groups = {};
    for (const [id, e] of Object.entries(inbox || {})) {
      if (!e) continue;
      const key = e.projectId || '';
      const g = groups[key] = groups[key] || {
        projectId: e.projectId || null,
        name: e.projectId ? projectNames[e.projectId] || 'Project ' + e.projectId.slice(0, 8) : 'Chats outside a project',
        unread: 0,
        entries: [],
      };
      g.entries.push({ id, ...e });
      if (e.unread) g.unread++;
    }
    const list = Object.values(groups);
    for (const g of list) g.entries.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    list.sort((a, b) => (!a.projectId - !b.projectId) || (b.entries[0].finishedAt || 0) - (a.entries[0].finishedAt || 0));
    return list;
  }

  const api = { MAX_ENTRIES, clip, add, markRead, unreadCount, arrivals, groupByProject };
  root.CCC = root.CCC || {};
  root.CCC.inbox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
