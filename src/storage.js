// chrome.storage layout
//   sync:  "color:<chatId>" -> "#rrggbb", "pcolor:<projectId>" -> "#rrggbb", "settings" -> {...},
//          "recentColors" -> ["#rrggbb", ...]
//   local: "status:<chatId>" -> status entry, "projectMap" -> {chatId: projectId}, "titles" -> {chatId: title},
//          "projectRank" -> {chatId: 0-based position in its project, newest first},
//          "auto" -> {chats: {chatId: i}, projects: {projectId: i}, next: n}  (automatic color rotation)
//          "pause" -> {since, until|null}  (time tracking paused on this device)
//          "discard" -> {from, to}  (last discarded window; a signal to open tabs)
//          "time:YYYY-MM-DD" -> [{id, chatId, kind, start, end}]  (time-tracking segments, see activity.js)
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    topbar: true, composer: true, sidebar: true, tint: false, groupByProject: true,
    tracking: true, idleSeconds: 90,
  };

  function emptyState() {
    return {
      colors: {}, projectColors: {}, settings: { ...DEFAULT_SETTINGS }, recent: [],
      statuses: {}, projectMap: {}, titles: {}, projectRank: {}, auto: emptyAuto(), pause: null,
    };
  }

  function emptyAuto() {
    return { chats: {}, projects: {}, next: 0 };
  }

  function setOrDelete(obj, key, value) {
    if (value === undefined || value === null) delete obj[key];
    else obj[key] = value;
  }

  // Applies one storage item to the in-memory state (value undefined = removed).
  function applyItem(state, area, key, value) {
    if (area === 'sync') {
      if (key.startsWith('color:')) setOrDelete(state.colors, key.slice(6), value);
      else if (key.startsWith('pcolor:')) setOrDelete(state.projectColors, key.slice(7), value);
      else if (key === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...(value || {}) };
      else if (key === 'recentColors') state.recent = Array.isArray(value) ? value : [];
    } else if (area === 'local') {
      if (key.startsWith('status:')) setOrDelete(state.statuses, key.slice(7), value);
      else if (key === 'projectMap') state.projectMap = { ...(value || {}) };
      else if (key === 'titles') state.titles = { ...(value || {}) };
      else if (key === 'projectRank') state.projectRank = { ...(value || {}) };
      else if (key === 'auto') state.auto = { ...emptyAuto(), ...(value || {}) };
      else if (key === 'pause') state.pause = value || null;
    }
    return state;
  }

  function fromItems(sync, local) {
    const state = emptyState();
    for (const [k, v] of Object.entries(sync || {})) applyItem(state, 'sync', k, v);
    for (const [k, v] of Object.entries(local || {})) applyItem(state, 'local', k, v);
    return state;
  }

  function applyChanges(state, area, changes) {
    for (const [k, c] of Object.entries(changes)) applyItem(state, area, k, c.newValue);
    return state;
  }

  // Merge {key: value|null} into a map; returns null when nothing changed.
  function mergeMap(existing, updates) {
    const next = { ...(existing || {}) };
    let changed = false;
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined) {
        if (k in next) { delete next[k]; changed = true; }
      } else if (next[k] !== v) {
        next[k] = v;
        changed = true;
      }
    }
    return changed ? next : null;
  }

  const store = () => root.chrome.storage;

  async function loadAll() {
    const [sync, local] = await Promise.all([store().sync.get(null), store().local.get(null)]);
    return fromItems(sync, local);
  }

  const setChatColor = (id, hex) => store().sync.set({ ['color:' + id]: hex.toLowerCase() });
  const clearChatColor = (id) => store().sync.remove('color:' + id);
  const setProjectColor = (id, hex) => store().sync.set({ ['pcolor:' + id]: hex.toLowerCase() });
  const clearProjectColor = (id) => store().sync.remove('pcolor:' + id);

  async function saveSettings(partial) {
    const { settings } = await store().sync.get('settings');
    return store().sync.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}), ...partial } });
  }

  function setStatus(id, entry) {
    return entry ? store().local.set({ ['status:' + id]: entry }) : store().local.remove('status:' + id);
  }

  async function mergeLocalMap(key, updates) {
    const items = await store().local.get(key);
    const next = mergeMap(items[key], updates);
    if (next) await store().local.set({ [key]: next });
    return !!next;
  }

  // Merge automatic color assignments from this tab into storage. Existing assignments win, so
  // two tabs that raced end up agreeing once onChanged delivers the stored value.
  function mergeAutoValues(stored, mine) {
    const base = { ...emptyAuto(), ...(stored || {}) };
    const next = { chats: { ...mine.chats, ...base.chats }, projects: { ...mine.projects, ...base.projects }, next: Math.max(base.next, mine.next) };
    const changed = Object.keys(next.chats).length !== Object.keys(base.chats).length ||
      Object.keys(next.projects).length !== Object.keys(base.projects).length || next.next !== base.next;
    return changed ? next : null;
  }

  async function mergeAuto(mine) {
    const { auto } = await store().local.get('auto');
    const next = mergeAutoValues(auto, mine);
    if (next) await store().local.set({ auto: next });
  }

  // Most-recent-first list of colors you picked, no duplicates.
  function withRecent(list, hex) {
    hex = hex.toLowerCase();
    return [hex, ...(list || []).filter((c) => c !== hex)].slice(0, 10);
  }

  async function pushRecent(hex) {
    const { recentColors } = await store().sync.get('recentColors');
    return store().sync.set({ recentColors: withRecent(recentColors, hex) });
  }

  async function markAllSeen() {
    const all = await store().local.get(null);
    const updates = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('status:') && v && v.unseen) updates[k] = { ...v, unseen: false };
    }
    if (Object.keys(updates).length) await store().local.set(updates);
  }

  // ---------- time tracking ----------

  const Act = () => root.CCC.activity;
  const isTimeKey = (k) => k.startsWith('time:');

  // { "time:YYYY-MM-DD": [segments starting that local day] }
  function segmentsByDayKey(segments) {
    const out = {};
    for (const s of segments) (out['time:' + Act().dayKey(s.start)] = out['time:' + Act().dayKey(s.start)] || []).push(s);
    return out;
  }

  // Insert or update segments (matched by id). Reads and writes only the days involved.
  async function saveSegments(segments) {
    const groups = segmentsByDayKey(segments.filter((s) => s.end > s.start));
    const keys = Object.keys(groups);
    if (!keys.length) return;
    const items = await store().local.get(keys);
    const updates = {};
    for (const k of keys) {
      const next = Act().mergeSegments(items[k], groups[k]);
      if (next) updates[k] = next;
    }
    if (Object.keys(updates).length) await store().local.set(updates);
  }

  // Segments from the local days overlapping [from, to] (or every stored day with { all: true }).
  async function loadSegments(from, to, { all = false } = {}) {
    let items;
    if (all) {
      const everything = await store().local.get(null);
      items = Object.fromEntries(Object.entries(everything).filter(([k]) => isTimeKey(k)));
    } else {
      items = await store().local.get(Act().daysBetween(from, to).map((d) => 'time:' + d));
    }
    return Object.values(items).flat().sort((a, b) => a.start - b.start);
  }

  // Removes [from, to) from the stored timeline ("that wasn't me, don't count it").
  async function discardTime(from, to) {
    const keys = Act().daysBetween(from, to).map((d) => 'time:' + d);
    const items = await store().local.get(keys);
    const updates = {};
    for (const [k, list] of Object.entries(items)) {
      const next = Act().trimSegments(list, from, to);
      if (next !== list) updates[k] = next;
    }
    // Tabs that are tracking right now hold an unsaved segment; this key tells them to cut it too.
    await store().local.set({ ...updates, discard: { from, to } });
  }

  async function pruneTime(now) {
    const stale = Act().staleDayKeys(Object.keys(await store().local.get(null)), now);
    if (stale.length) await store().local.remove(stale);
  }

  async function clearTime() {
    const keys = Object.keys(await store().local.get(null)).filter(isTimeKey);
    if (keys.length) await store().local.remove(keys);
  }

  function setPause(pause) {
    return pause ? store().local.set({ pause }) : store().local.remove('pause');
  }

  // Keyboard shortcut / one-click: resume if paused, otherwise pause until resumed.
  async function togglePause(now) {
    const { pause } = await store().local.get('pause');
    return setPause(Act().isPaused(pause, now) ? null : { since: now, until: null });
  }

  function onChanged(fn) {
    store().onChanged.addListener(fn);
  }

  const api = {
    DEFAULT_SETTINGS, emptyState, applyItem, fromItems, applyChanges, mergeMap, mergeAutoValues, withRecent,
    loadAll, setChatColor, clearChatColor, setProjectColor, clearProjectColor,
    saveSettings, setStatus, mergeLocalMap, mergeAuto, pushRecent, markAllSeen, onChanged,
    segmentsByDayKey, saveSegments, loadSegments, discardTime, pruneTime, clearTime, setPause, togglePause,
  };
  root.CCC = root.CCC || {};
  root.CCC.storage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
