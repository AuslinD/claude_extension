// Pure state machine for "is this chat still generating?".
//
// Entry shapes (stored at chrome.storage.local["status:<chatId>"]):
//   running: { state:'running', owner, heartbeat, startedAt, lastPoll?, fp?, stableSince? }
//   done:    { state:'done', finishedAt, unseen, uncertain }
(function (root) {
  'use strict';

  const config = {
    HEARTBEAT_MS: 2000,   // how often the streaming tab refreshes its heartbeat
    STALE_MS: 6000,       // no heartbeat for this long -> nobody is watching, start polling the API
    POLL_MS: 5000,        // API poll interval for unwatched running chats
    STABLE_MS: 20000,     // conversation unchanged this long (and last msg is Claude's) -> done
    FALLBACK_MS: 180000,  // no evidence of activity this long -> assume done ("uncertain")
    PRUNE_MS: 86400000,   // forget seen/finished entries after a day
    CLOCK_SKEW_MS: 30000,
  };

  function done(now, unseen, uncertain) {
    return { state: 'done', finishedAt: now, unseen: !!unseen, uncertain: !!uncertain };
  }

  // Called every tick for the chat the tab is currently showing.
  function observeLocal(prev, { streaming, now, viewing, owner }) {
    const running = !!prev && prev.state === 'running';
    if (streaming) {
      if (running && prev.owner === owner && now - prev.heartbeat < config.HEARTBEAT_MS) return prev;
      return { state: 'running', owner, heartbeat: now, startedAt: running ? prev.startedAt : now };
    }
    if (running) {
      // Someone else started it (another tab, or before a reload): let the API poll decide.
      if (prev.owner !== owner) return prev;
      return done(now, !viewing, false);
    }
    if (prev && prev.unseen && viewing) return { ...prev, unseen: false };
    return prev || null;
  }

  function needsPoll(e, now) {
    return !!e && e.state === 'running' &&
      now - e.heartbeat >= config.STALE_MS &&
      (!e.lastPoll || now - e.lastPoll >= config.POLL_MS);
  }

  function fingerprint(s) {
    return [s.updatedAt, s.messageCount, s.lastSender, s.lastUpdatedAt, s.lastLen].join('|');
  }

  function freshAssistantReply(e, s) {
    if (s.lastSender !== 'assistant') return false;
    const t = Date.parse(s.lastUpdatedAt || '');
    return isNaN(t) || !e.startedAt || t >= e.startedAt - config.CLOCK_SKEW_MS;
  }

  // summary: output of CCC.api.summarizeConversation, or null when the fetch failed.
  function applyPoll(e, summary, now) {
    if (!e || e.state !== 'running') return e;
    if (!summary) return { ...e, lastPoll: now };
    const fresh = freshAssistantReply(e, summary);
    if (fresh && summary.stopReason) return done(now, true, false);
    const fp = fingerprint(summary);
    if (fp !== e.fp) return { ...e, lastPoll: now, fp, stableSince: now };
    if (fresh && now - (e.stableSince || now) >= config.STABLE_MS) return done(now, true, false);
    return { ...e, lastPoll: now };
  }

  // Timeouts. Returns the same entry, a replacement, or null to delete it.
  function expire(e, now) {
    if (!e) return e;
    if (e.state === 'running') {
      const lastActivity = Math.max(e.heartbeat || 0, e.stableSince || 0);
      if (now - e.heartbeat < config.STALE_MS) return e;
      if (now - lastActivity >= config.FALLBACK_MS) return done(now, true, true);
      return e;
    }
    if (e.state === 'done' && !e.unseen && now - (e.finishedAt || 0) >= config.PRUNE_MS) return null;
    return e;
  }

  // What to draw in the sidebar: 'running' | 'done' | 'uncertain' | null
  function markerFor(e) {
    if (!e) return null;
    if (e.state === 'running') return 'running';
    if (e.state === 'done' && e.unseen) return e.uncertain ? 'uncertain' : 'done';
    return null;
  }

  const api = { config, observeLocal, needsPoll, applyPoll, expire, markerFor, fingerprint };
  root.CCC = root.CCC || {};
  root.CCC.status = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
