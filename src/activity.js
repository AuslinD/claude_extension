// Pure time tracking: what are you doing in claude.ai right now, and for how long?
//
// Every second the content script reports what it sees (tab focused? typing? Claude generating?
// last mouse/keyboard input?). `classify` turns that into one activity:
//   prompting  you typed in the message box in the last TYPING_MS
//   waiting    Claude is generating and you're on the tab
//   reading    on the tab, recent input, nothing else going on
//   idle       on the tab but no input for the idle timeout -> recorded, but excluded from totals
//   null       tab hidden / window unfocused / tracking paused -> not recorded at all
// `step` merges consecutive seconds of the same activity in the same chat into one segment:
//   { id, chatId, kind, start, end }   (ms timestamps; stored per local day, see storage.js)
(function (root) {
  'use strict';

  const config = {
    TICK_MAX_MS: 5000,      // a longer pause between ticks (sleep, throttled tab) is never credited
    TYPING_MS: 15000,       // typed this recently -> prompting
    IDLE_MS: 90000,         // default "no input for this long -> idle" (user setting overrides)
    WAIT_IDLE_MS: 180000,   // minimum idle timeout while Claude is generating
    FLUSH_MS: 10000,        // how often the open segment is saved
    RETAIN_DAYS: 60,
  };

  const KINDS = ['prompting', 'waiting', 'reading'];
  const LABELS = { prompting: 'Prompting', waiting: 'Waiting', reading: 'Reading', idle: 'Idle (not counted)' };
  const DAY_MS = 86400000;

  // ---------- classification ----------

  function classify({ viewing, paused, streaming, now, typedAt, inputAt, streamStart, idleMs }) {
    if (!viewing || paused) return null;
    const sentThisTyping = streaming && streamStart != null && typedAt <= streamStart;
    if (typedAt != null && now - typedAt < config.TYPING_MS && !sentThisTyping) return 'prompting';
    const limit = streaming ? Math.max(idleMs || config.IDLE_MS, config.WAIT_IDLE_MS) : idleMs || config.IDLE_MS;
    if (inputAt == null || now - inputAt >= limit) return 'idle';
    return streaming ? 'waiting' : 'reading';
  }

  // ---------- ticks -> segments ----------

  function newTracker() {
    return { open: null, last: null, counting: false, streaming: false, streamStart: null };
  }

  // obs: { now, owner, chatId, viewing, paused, streaming, typedAt, inputAt, idleMs }
  // Returns { tracker, closed } where closed = finished segments to save.
  function step(tr, obs) {
    const { now } = obs;
    const closed = [];
    const streamStart = obs.streaming ? (tr.streaming ? tr.streamStart : now) : null;
    const kind = classify({ ...obs, streamStart });
    const gap = tr.last == null || now < tr.last || now - tr.last > config.TICK_MAX_MS;
    const sameDay = tr.last != null && dayKey(tr.last) === dayKey(now);
    const chatId = obs.chatId || null;
    let open = tr.open;

    const close = () => {
      if (open && open.end > open.start) closed.push(open);
      open = null;
    };

    if (!kind || gap) close();
    if (kind) {
      if (open && open.kind === kind && open.chatId === chatId && sameDay) {
        open = { ...open, end: now };
      } else {
        close();
        // The second since the last tick belongs to the new activity, unless that tick wasn't counted.
        const start = tr.counting && !gap && sameDay ? tr.last : now;
        open = { id: obs.owner + ':' + start, chatId, kind, start, end: now };
      }
    }
    return {
      tracker: { open, last: now, counting: !!kind, streaming: !!obs.streaming, streamStart },
      closed,
    };
  }

  // A window was discarded while this tab has an unsaved open segment: cut it the same way and close it.
  // Returns { tracker, pieces } where pieces = what's left of the open segment, to save.
  function discardFromTracker(tr, from, to) {
    const open = tr.open;
    if (!open || open.end <= from || open.start >= to) return { tracker: tr, pieces: [] };
    return { tracker: { ...tr, open: null, counting: false }, pieces: trimSegments([open], from, to) };
  }

  // ---------- reporting ----------

  function emptyKinds() {
    return { prompting: 0, waiting: 0, reading: 0, idle: 0 };
  }

  function addTo(bucket, kind, ms) {
    bucket[kind] = (bucket[kind] || 0) + ms;
    if (kind !== 'idle') bucket.total = (bucket.total || 0) + ms;
  }

  // Totals by activity, by chat ('' = not in a chat) and by local day, clipped to [from, to).
  function summarize(segments, { from = -Infinity, to = Infinity } = {}) {
    const kinds = emptyKinds();
    const byChat = {};
    const byDay = {};
    let total = 0;
    for (const s of segments || []) {
      const a = Math.max(s.start, from), b = Math.min(s.end, to);
      if (b <= a) continue;
      const ms = b - a;
      kinds[s.kind] = (kinds[s.kind] || 0) + ms;
      if (s.kind !== 'idle') total += ms;
      addTo(byChat[s.chatId || ''] = byChat[s.chatId || ''] || { ...emptyKinds(), total: 0 }, s.kind, ms);
      const d = dayKey(a);
      addTo(byDay[d] = byDay[d] || { ...emptyKinds(), total: 0 }, s.kind, ms);
    }
    return { total, kinds, byChat, byDay };
  }

  // [{ kind, label, ms, pct }] for the three counted activities. pct are whole numbers that add up to
  // 100 (largest remainder; ties go to the earlier activity).
  function splitRows(kinds) {
    const ms = KINDS.map((k) => kinds[k] || 0);
    const total = ms.reduce((a, b) => a + b, 0);
    const exact = ms.map((v) => (total ? (v * 100) / total : 0));
    const pct = exact.map(Math.floor);
    let left = total ? 100 - pct.reduce((a, b) => a + b, 0) : 0;
    const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, i] of order) if (left-- > 0) pct[i]++;
    return KINDS.map((kind, i) => ({ kind, label: LABELS[kind], ms: ms[i], pct: pct[i] }));
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

  // Chart columns: one per hour when the range is a single day, otherwise one per day.
  // { unit, max, list: [{ key, label, start, end, kinds, total }] }; segments are split at column edges.
  function buckets(segments, { from, to }) {
    const unit = dayKey(from) === dayKey(to) ? 'hour' : 'day';
    const list = [];
    if (unit === 'hour') {
      const d = new Date(from);
      const last = new Date(to).getHours();
      for (let h = 0; h <= last; h++) {
        list.push({ key: String(h), label: hourLabel(h),
          start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime(),
          end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1).getTime() });
      }
    } else {
      daysBetween(from, to).forEach((key, i) => {
        const start = dayStart(from, i);
        list.push({ key, label: `${WEEKDAYS[new Date(start).getDay()]} ${new Date(start).getDate()}`, start, end: dayStart(from, i + 1) });
      });
    }
    let max = 0;
    for (const b of list) {
      const sum = summarize(segments, { from: b.start, to: b.end });
      b.kinds = sum.kinds;
      b.total = sum.total;
      max = Math.max(max, b.total);
    }
    return { unit, max, list };
  }

  // Removes the window [from, to) from every segment ("discard the last 10 minutes").
  function trimSegments(segments, from, to) {
    let changed = false;
    const out = [];
    for (const s of segments) {
      if (s.end <= from || s.start >= to) {
        out.push(s);
        continue;
      }
      changed = true;
      if (s.start < from) out.push({ ...s, end: from });
      if (s.end > to) out.push({ ...s, id: s.id + '~' + to, start: to });
    }
    return changed ? out : segments;
  }

  // Insert or replace segments by id; returns the new sorted list, or null if nothing changed.
  function mergeSegments(list, updates) {
    const byId = new Map((list || []).map((s) => [s.id, s]));
    let changed = false;
    for (const s of updates) {
      if (!(s.end > s.start)) continue;
      const prev = byId.get(s.id);
      if (prev && prev.end === s.end && prev.start === s.start && prev.kind === s.kind && prev.chatId === s.chatId) continue;
      byId.set(s.id, s);
      changed = true;
    }
    return changed ? Array.from(byId.values()).sort((a, b) => a.start - b.start) : null;
  }

  // ---------- days and ranges (local time) ----------

  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayStart(ms, offsetDays = 0) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).getTime();
  }

  const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30 };

  function rangeFor(range, now) {
    const days = RANGE_DAYS[range] || 1;
    return { from: dayStart(now, -(days - 1)), to: now };
  }

  // Every local day from `from` to `to`, inclusive, as 'YYYY-MM-DD'.
  function daysBetween(from, to) {
    const out = [];
    for (let i = 0, t = dayStart(from); t <= to && i < 4000; i++, t = dayStart(from, i)) out.push(dayKey(t));
    return out;
  }

  function staleDayKeys(keys, now, retainDays = config.RETAIN_DAYS) {
    const cutoff = 'time:' + dayKey(dayStart(now, -(retainDays - 1)));
    return keys.filter((k) => k.startsWith('time:') && k < cutoff);
  }

  // ---------- pause ----------

  // pause: { since, until|null } (null until = paused until you resume) or null.
  function isPaused(pause, now) {
    return !!pause && (pause.until == null || now < pause.until);
  }

  // ---------- formatting ----------

  function formatDuration(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  }

  const api = {
    config, KINDS, LABELS, DAY_MS,
    classify, newTracker, step, discardFromTracker, summarize, splitRows, buckets, trimSegments, mergeSegments,
    dayKey, dayStart, rangeFor, daysBetween, staleDayKeys, isPaused, formatDuration,
  };
  root.CCC = root.CCC || {};
  root.CCC.activity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
