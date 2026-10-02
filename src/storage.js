// chrome.storage layout
//   sync:  "color:<chatId>" -> "#rrggbb", "pcolor:<projectId>" -> "#rrggbb", "settings" -> {...},
//          "recentColors" -> ["#rrggbb", ...]
//   local: "status:<chatId>" -> status entry, "projectMap" -> {chatId: projectId}, "titles" -> {chatId: title},
//          "projectRank" -> {chatId: 0-based position in its project, newest first},
//          "auto" -> {chats: {chatId: i}, projects: {projectId: i}, next: n}  (automatic color rotation)
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = { topbar: true, composer: true, sidebar: true, tint: false, groupByProject: true };

  function emptyState() {
    return {
      colors: {}, projectColors: {}, settings: { ...DEFAULT_SETTINGS }, recent: [],
      statuses: {}, projectMap: {}, titles: {}, projectRank: {}, auto: emptyAuto(),
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

  function onChanged(fn) {
    store().onChanged.addListener(fn);
  }

  const api = {
    DEFAULT_SETTINGS, emptyState, applyItem, fromItems, applyChanges, mergeMap, mergeAutoValues, withRecent,
    loadAll, setChatColor, clearChatColor, setProjectColor, clearProjectColor,
    saveSettings, setStatus, mergeLocalMap, mergeAuto, pushRecent, markAllSeen, onChanged,
  };
  root.CCC = root.CCC || {};
  root.CCC.storage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
