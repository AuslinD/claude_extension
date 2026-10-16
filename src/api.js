// Best-effort use of claude.ai's own (undocumented) web API, using the user's existing session.
// Every failure returns null so callers can fall back to DOM-only behavior.
(function (root) {
  'use strict';

  // -> { projectMap: {chatId: projectId|null}, titles: {chatId: name}, projectRank: {chatId: 0..n},
  //      projectNames: {projectId: name} }
  // Rank = position in the project by creation time, newest first. Creation time (not last
  // activity) keeps a chat's shade stable when you reply in a sibling chat.
  function parseConversationList(json) {
    const arr = Array.isArray(json) ? json : json && (json.data || json.conversations);
    if (!Array.isArray(arr)) return null;
    const projectMap = {}, titles = {}, projectRank = {}, projectNames = {}, byProject = {};
    for (const c of arr) {
      const id = c && (c.uuid || c.id);
      if (!id) continue;
      const pid = c.project_uuid || (c.project && c.project.uuid) || null;
      projectMap[id] = pid;
      if (c.name) titles[id] = c.name;
      if (pid && c.project && c.project.name) projectNames[pid] = c.project.name;
      if (pid) (byProject[pid] = byProject[pid] || []).push({ id, t: Date.parse(c.created_at || c.updated_at || '') || 0 });
    }
    for (const list of Object.values(byProject)) {
      list.sort((a, b) => b.t - a.t);
      list.forEach((c, i) => { projectRank[c.id] = i; });
    }
    return { projectMap, titles, projectRank, projectNames };
  }

  // Tool calls that hand work to a subagent. claude.ai doesn't document these names, so match broadly.
  const SUBAGENT_TOOL_RE = /agent|subtask|task|delegate|extended_search/i;

  function blockText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((b) => (typeof b === 'string' ? b : b && (b.text || b.content && blockText(b.content)) || '')).join(' ');
  }

  // Subagents launched in one message -> [{ id, name, task, summary, done, isError, finishedAt }]
  function extractSubagents(message) {
    const blocks = message && Array.isArray(message.content) ? message.content : [];
    const results = {};
    for (const b of blocks) if (b && b.type === 'tool_result' && b.tool_use_id) results[b.tool_use_id] = b;
    const out = [];
    for (const b of blocks) {
      if (!b || b.type !== 'tool_use' || !b.id || !SUBAGENT_TOOL_RE.test(b.name || '')) continue;
      const input = b.input || {};
      const r = results[b.id];
      out.push({
        id: b.id,
        name: b.name,
        task: input.description || input.title || input.task || input.prompt || input.command || '',
        summary: r ? blockText(r.content) : '',
        done: !!r,
        isError: !!(r && r.is_error),
        finishedAt: r ? Date.parse(r.stop_timestamp || r.start_timestamp || '') || null : null,
      });
    }
    return out;
  }

  function summarizeConversation(json) {
    if (!json || typeof json !== 'object') return null;
    const msgs = Array.isArray(json.chat_messages) ? json.chat_messages : [];
    let last = json.current_leaf_message_uuid ? msgs.find((m) => m.uuid === json.current_leaf_message_uuid) : null;
    if (!last) {
      for (const m of msgs) if (!last || (m.index ?? 0) >= (last.index ?? 0)) last = m;
    }
    const lastLen = !last ? 0 : Array.isArray(last.content) ? JSON.stringify(last.content).length : String(last.text || '').length;
    return {
      updatedAt: json.updated_at || null,
      messageCount: msgs.length,
      lastSender: last ? last.sender || null : null,
      lastUpdatedAt: last ? last.updated_at || last.created_at || null : null,
      lastLen,
      stopReason: (last && last.stop_reason) || null,
      // Only the latest reply, so opening an old chat doesn't fill the inbox with past runs.
      subagents: last && last.sender === 'assistant' ? extractSubagents(last) : [],
    };
  }

  function enabled() {
    const loc = root.location;
    return !!loc && loc.protocol === 'https:' && /(^|\.)claude\.ai$/.test(loc.hostname) && typeof fetch === 'function';
  }

  // Last outcome of each kind of request, for the popup's diagnostics.
  const stats = { list: 'not tried', conversation: 'not tried' };

  async function getJson(url) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      return r.ok ? await r.json() : { __error: 'HTTP ' + r.status };
    } catch (e) {
      return { __error: String(e && e.message || e) };
    }
  }

  function unwrap(kind, json) {
    if (json && json.__error) {
      stats[kind] = 'failed: ' + json.__error;
      return null;
    }
    stats[kind] = json ? 'ok' : 'unavailable';
    return json;
  }

  let orgPromise = null;
  function orgId() {
    if (!orgPromise) {
      orgPromise = (async () => {
        const m = /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(root.document.cookie || '');
        if (m) return decodeURIComponent(m[1]);
        let orgs = await getJson('/api/organizations');
        if (orgs && orgs.__error) orgs = null;
        if (!Array.isArray(orgs) || !orgs.length) return null;
        const o = orgs.find((x) => (x.capabilities || []).includes('chat')) || orgs[0];
        return o.uuid || null;
      })().then((id) => {
        if (!id) orgPromise = null;
        return id;
      });
    }
    return orgPromise;
  }

  async function orgGet(path) {
    if (!enabled()) return null;
    const org = await orgId();
    return org ? getJson('/api/organizations/' + org + path) : null;
  }

  async function fetchConversationList() {
    return parseConversationList(unwrap('list', await orgGet('/chat_conversations?limit=200')));
  }

  async function fetchConversationSummary(chatId) {
    return summarizeConversation(unwrap('conversation',
      await orgGet('/chat_conversations/' + chatId + '?tree=True&rendering_mode=messages&render_all_tools=true')
    ));
  }

  const api = {
    stats, SUBAGENT_TOOL_RE,
    parseConversationList, extractSubagents, summarizeConversation, fetchConversationList, fetchConversationSummary,
  };
  root.CCC = root.CCC || {};
  root.CCC.api = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
