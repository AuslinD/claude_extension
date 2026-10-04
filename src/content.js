// Wires everything together on claude.ai: painting, status tracking, project detection, inline picker.
(() => {
  'use strict';
  if (globalThis.__cccLoaded) return;
  globalThis.__cccLoaded = true;

  const { colors: Colors, selectors: S, status: St, storage: Store, api: Api } = globalThis.CCC;
  const TEST = globalThis.CCC_TEST || null;
  const OWNER = (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const TICK_MS = 1000;
  const LIST_REFRESH_MS = 10 * 60 * 1000;
  const PAINT_THROTTLE_MS = 150;

  let data = Store.emptyState();
  let current = { path: null, chatId: null };
  let preview = null; // { chatId, color } while dragging the color input
  let composerEl = null;
  const composerResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => positionPill()) : null;
  let paintTimer = null;
  let lastPaint = 0;
  let timers = [];
  let observer = null;
  const polling = new Set();

  const now = () => Date.now();
  const alive = () => !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
  const isViewing = () =>
    TEST && 'viewing' in TEST ? !!TEST.viewing : !document.hidden && document.hasFocus();

  function safe(promise) {
    if (promise && promise.catch) promise.catch(() => {});
  }

  // ---------- colors ----------

  function projectOf(id) {
    return data.settings.groupByProject ? data.projectMap[id] || null : null;
  }

  // Hand out the next automatic color the first time a chat/project is seen. Kept in memory
  // immediately (no flicker) and persisted in one batched write.
  let autoDirty = false;
  function autoIndex(kind, id) {
    const map = data.auto[kind];
    if (!(id in map)) {
      map[id] = data.auto.next++;
      autoDirty = true;
    }
    return map[id];
  }

  function flushAuto() {
    if (!autoDirty) return;
    autoDirty = false;
    safe(Store.mergeAuto(data.auto));
  }

  // Faded project colors are blended onto the real page background so they read as
  // "see-through" in both light and dark mode.
  let pageBg = '#ffffff';
  function readPageBackground() {
    const css = (el) => el && Colors.cssToHex(getComputedStyle(el).backgroundColor);
    const dark = globalThis.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    pageBg = css(document.body) || css(document.documentElement) || (dark ? '#262624' : '#ffffff');
  }

  function colorInfo(id) {
    const projectId = projectOf(id);
    const override = preview && preview.chatId === id ? preview.color : data.colors[id];
    const projectOverride = projectId ? data.projectColors[projectId] : null;
    return Colors.resolveColor({
      chatId: id,
      projectId,
      override,
      projectOverride,
      projectAutoIndex: projectId && !projectOverride ? autoIndex('projects', projectId) : undefined,
      rank: data.projectRank[id],
      autoIndex: !projectId && !override ? autoIndex('chats', id) : undefined,
      background: pageBg,
    });
  }

  // ---------- painting ----------

  function schedulePaint() {
    if (paintTimer) return;
    const wait = Math.max(0, PAINT_THROTTLE_MS - (now() - lastPaint));
    paintTimer = setTimeout(paint, wait);
  }

  function setAttr(el, name, value) {
    if (value === null || value === undefined) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  }

  function ensureEl(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
    return el;
  }

  function paint() {
    paintTimer = null;
    lastPaint = now();
    if (!document.body) return;
    readPageBackground();
    const id = current.chatId;
    const rootEl = document.documentElement;
    if (id) {
      const { color } = colorInfo(id);
      rootEl.style.setProperty('--ccc-color', color);
      rootEl.style.setProperty('--ccc-text', Colors.textColorFor(color));
    }
    setAttr(rootEl, 'data-ccc-active', id ? '' : null);

    ensureEl('ccc-topbar').hidden = !(id && data.settings.topbar);
    ensureEl('ccc-tint').hidden = !(id && data.settings.tint);
    paintComposer(id);
    paintSidebar(id);
    flushAuto();
  }

  function paintComposer(id) {
    const comp = id ? S.composer(document) : null;
    if (composerEl !== comp) {
      if (composerEl) composerEl.removeAttribute('data-ccc-composer');
      // The message box grows (usually upward) as you type; keep the label glued to its top edge.
      if (composerResize) {
        composerResize.disconnect();
        if (comp) composerResize.observe(comp);
      }
    }
    composerEl = comp;
    if (comp) setAttr(comp, 'data-ccc-composer', data.settings.composer ? '' : null);

    const pill = ensureEl('ccc-pill');
    if (!pill.firstChild) {
      pill.title = 'This chat’s color — click to change';
      pill.innerHTML = '<span class="ccc-dot"></span><span class="ccc-label"></span>';
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!current.chatId) return;
        const r = pill.getBoundingClientRect();
        openPicker(current.chatId, currentTitle(), r.left, r.bottom + 6);
      });
    }
    pill.hidden = !id;
    if (!id) return;
    const label = pill.querySelector('.ccc-label');
    const title = currentTitle();
    if (label.textContent !== title) label.textContent = title;
    positionPill();
  }

  function positionPill() {
    const pill = document.getElementById('ccc-pill');
    if (!pill || pill.hidden) return;
    const r = composerEl && composerEl.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      const h = pill.offsetHeight || 22;
      // Straddle the composer's top border, like a fieldset legend.
      pill.style.left = Math.max(8, r.left + 16) + 'px';
      pill.style.top = Math.max(8, r.top - h / 2) + 'px';
      pill.style.transform = '';
    } else {
      pill.style.left = '50%';
      pill.style.top = '10px';
      pill.style.transform = 'translateX(-50%)';
    }
  }

  function currentTitle() {
    const id = current.chatId;
    const t = S.chatTitle(document);
    if (t && id && data.titles[id] !== t) {
      data.titles[id] = t;
      safe(Store.mergeLocalMap('titles', { [id]: t }));
    }
    return t || (id && data.titles[id]) || 'Untitled chat';
  }

  function paintSidebar(currentId) {
    const enabled = data.settings.sidebar;
    const seen = new Set();
    for (const a of S.chatLinks(document)) {
      const cid = S.chatIdFromPath(a.getAttribute('href'));
      if (!enabled) break;
      seen.add(a);
      setAttr(a, 'data-ccc-id', cid);
      const color = colorInfo(cid).color;
      if (a.style.getPropertyValue('--ccc-c') !== color) a.style.setProperty('--ccc-c', color);
      setAttr(a, 'data-ccc-status', St.markerFor(data.statuses[cid]));
      setAttr(a, 'data-ccc-current', cid === currentId ? '' : null);
    }
    for (const a of document.querySelectorAll('a[data-ccc-id]')) {
      if (seen.has(a)) continue;
      a.removeAttribute('data-ccc-id');
      a.removeAttribute('data-ccc-status');
      a.removeAttribute('data-ccc-current');
      a.style.removeProperty('--ccc-c');
    }
  }

  // ---------- inline color picker ----------

  function closePicker() {
    const el = document.getElementById('ccc-picker');
    if (el) el.remove();
    if (preview) {
      preview = null;
      schedulePaint();
    }
  }

  function button(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function openPicker(chatId, title, x, y) {
    closePicker();
    const projectId = projectOf(chatId);
    const el = document.createElement('div');
    el.id = 'ccc-picker';
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    // For a project chat that still uses the project color, picking recolors the whole project by default.
    let target = projectId && !data.colors[chatId] ? 'project' : 'chat';

    function render() {
      const info = colorInfo(chatId);
      el.replaceChildren();

      const head = document.createElement('div');
      head.className = 'ccc-title';
      head.textContent = title || 'Chat color';
      const desc = document.createElement('div');
      desc.className = 'ccc-src';
      desc.textContent = Colors.describe(info);
      el.append(head, desc);

      if (projectId) {
        const seg = document.createElement('div');
        seg.className = 'ccc-seg';
        for (const [val, label] of [['chat', 'This chat'], ['project', 'Whole project']]) {
          const b = button(label, () => { target = val; render(); });
          if (target === val) b.className = 'ccc-on';
          seg.appendChild(b);
        }
        el.appendChild(seg);
      }

      const selected = target === 'project' ? (data.projectColors[projectId] || info.base) : info.base;
      el.appendChild(globalThis.CCC.paletteUI.buildPalette(document, {
        selected,
        recent: data.recent,
        onPick: commit,
        onPreview: target === 'chat' ? (c) => { preview = { chatId, color: c }; schedulePaint(); } : null,
      }));

      const actions = document.createElement('div');
      actions.className = 'ccc-actions';
      if (data.colors[chatId]) {
        actions.appendChild(button('Reset this chat', () => {
          delete data.colors[chatId];
          safe(Store.clearChatColor(chatId));
          render();
          schedulePaint();
        }));
      }
      if (projectId && data.projectColors[projectId]) {
        actions.appendChild(button('Reset project', () => {
          delete data.projectColors[projectId];
          safe(Store.clearProjectColor(projectId));
          render();
          schedulePaint();
        }));
      }
      actions.appendChild(button('Done', closePicker));
      el.appendChild(actions);
    }

    function commit(color) {
      preview = null;
      color = color.toLowerCase();
      if (target === 'project') {
        data.projectColors[projectId] = color; // optimistic; onChanged confirms
        delete data.colors[chatId];
        safe(Store.setProjectColor(projectId, color));
        safe(Store.clearChatColor(chatId));
      } else {
        data.colors[chatId] = color;
        safe(Store.setChatColor(chatId, color));
      }
      data.recent = Store.withRecent(data.recent, color);
      safe(Store.pushRecent(color));
      render();
      schedulePaint();
    }

    render();
    document.body.appendChild(el);
    const w = el.offsetWidth || 380, h = el.offsetHeight || 260;
    el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  }

  function onDocMouseDown(e) {
    const picker = document.getElementById('ccc-picker');
    if (picker && !picker.contains(e.target)) closePicker();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closePicker();
  }

  function linkTitle(a) {
    return (a.textContent || '').trim().slice(0, 80);
  }

  // Alt+click a sidebar chat to recolor it without opening it.
  function onClick(e) {
    if (!e.altKey) return;
    const a = e.target.closest && e.target.closest('a[data-ccc-id]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    openPicker(a.getAttribute('data-ccc-id'), linkTitle(a), e.clientX, e.clientY);
  }

  // Right-click on the colored stripe (left edge) also opens the picker.
  function onContextMenu(e) {
    const a = e.target.closest && e.target.closest('a[data-ccc-id]');
    if (!a || e.clientX - a.getBoundingClientRect().left > 10) return;
    e.preventDefault();
    openPicker(a.getAttribute('data-ccc-id'), linkTitle(a), e.clientX, e.clientY);
  }

  // ---------- running / done status ----------

  function writeStatus(id, entry) {
    if (entry) data.statuses[id] = entry;
    else delete data.statuses[id];
    safe(Store.setStatus(id, entry));
    schedulePaint();
  }

  function checkStreaming() {
    const id = current.chatId;
    if (!id) return;
    const prev = data.statuses[id];
    const next = St.observeLocal(prev, { streaming: S.isStreaming(document), now: now(), viewing: isViewing(), owner: OWNER });
    if (next !== (prev || null)) writeStatus(id, next);
  }

  function checkStale() {
    const t = now();
    for (const [id, e] of Object.entries(data.statuses)) {
      const next = St.expire(e, t);
      if (next !== e) {
        writeStatus(id, next);
        continue;
      }
      if (!St.needsPoll(e, t) || polling.has(id)) continue;
      polling.add(id);
      Api.fetchConversationSummary(id)
        .then((summary) => {
          const cur = data.statuses[id];
          const n = St.applyPoll(cur, summary, now());
          if (cur && n !== cur) writeStatus(id, n);
        })
        .catch(() => {})
        .finally(() => polling.delete(id));
    }
  }

  // ---------- project detection ----------

  function detectProjectsFromDom() {
    const updates = {};
    const pagePid = S.projectIdFromPath(current.path);
    const pageChats = [];
    if (pagePid) {
      for (const a of S.chatLinks(document)) {
        if (S.isInSidebar(a)) continue;
        const cid = S.chatIdFromPath(a.getAttribute('href'));
        pageChats.push(cid);
        if (data.projectMap[cid] !== pagePid) updates[cid] = pagePid;
      }
    }
    if (current.chatId) {
      const pid = S.projectIdOnPage(document);
      if (pid && data.projectMap[current.chatId] !== pid) updates[current.chatId] = pid;
    }
    if (Object.keys(updates).length) {
      Object.assign(data.projectMap, updates);
      safe(Store.mergeLocalMap('projectMap', updates));
      schedulePaint();
    }
    // Without the API, fall back to the order the project page lists its chats in.
    if (pageChats.length && Api.stats.list !== 'ok') {
      const ranks = {};
      pageChats.forEach((cid, i) => { if (data.projectRank[cid] !== i) ranks[cid] = i; });
      if (Object.keys(ranks).length) {
        Object.assign(data.projectRank, ranks);
        safe(Store.mergeLocalMap('projectRank', ranks));
        schedulePaint();
      }
    }
    // A project chat we have no position for is usually brand new: refresh so it becomes "newest".
    const pid = current.chatId && data.projectMap[current.chatId];
    if (pid && !(current.chatId in data.projectRank)) refreshConversationListSoon();
  }

  let lastListRefresh = 0;
  function refreshConversationListSoon() {
    if (now() - lastListRefresh < 30000) return;
    safe(refreshConversationList());
  }

  async function refreshConversationList() {
    lastListRefresh = now();
    const list = await Api.fetchConversationList();
    if (!list) return;
    // Ranks are recomputed from scratch for every listed chat; drop stale ranks of chats that left a project.
    const ranks = { ...list.projectRank };
    for (const id of Object.keys(list.projectMap)) if (!(id in ranks)) ranks[id] = null;
    await Store.mergeLocalMap('projectMap', list.projectMap);
    await Store.mergeLocalMap('projectRank', ranks);
    await Store.mergeLocalMap('titles', list.titles);
  }

  // ---------- navigation + lifecycle ----------

  function checkUrl() {
    const path = S.currentPath();
    if (path === current.path) return;
    current = { path, chatId: S.chatIdFromPath(path) };
    closePicker();
    checkStreaming();
    schedulePaint();
  }

  function tick() {
    if (!alive()) return teardown();
    try {
      checkUrl();
      checkStreaming();
      checkStale();
      detectProjectsFromDom();
    } catch (e) {
      if (!alive()) teardown();
    }
  }

  function teardown() {
    timers.forEach(clearInterval);
    timers = [];
    if (observer) observer.disconnect();
  }

  function onMessage(msg, _sender, sendResponse) {
    if (!msg || msg.type !== 'ccc:getInfo') return false;
    const id = current.chatId;
    const res = { chatId: id, diagnostics: diagnostics() };
    if (id) {
      const info = colorInfo(id);
      const projectId = projectOf(id);
      Object.assign(res, {
        title: currentTitle(),
        projectId,
        color: info.color,
        base: info.base,
        source: info.source,
        description: Colors.describe(info),
        hasOverride: !!data.colors[id],
        hasProjectOverride: !!(projectId && data.projectColors[projectId]),
      });
    }
    sendResponse(res);
    return false;
  }

  // What the popup's "Copy diagnostics" button reports, to debug claude.ai markup changes.
  function diagnostics() {
    const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};
    return {
      version: manifest.version,
      page: current.chatId ? 'chat' : S.projectIdFromPath(current.path) ? 'project' : current.path,
      composerFound: !!S.composer(document),
      sidebarChatLinks: S.chatLinks(document).filter((a) => S.isInSidebar(a)).length,
      allChatLinks: S.chatLinks(document).length,
      streamingNow: S.isStreaming(document),
      titleFound: !!S.chatTitle(document),
      projectOfThisChat: current.chatId ? data.projectMap[current.chatId] || null : null,
      knownProjectChats: Object.values(data.projectMap).filter(Boolean).length,
      apiChatList: Api.stats.list,
      apiConversation: Api.stats.conversation,
      pageBackground: pageBg,
      browser: navigator.userAgent.replace(/^.*(Chrome\/[\d.]+).*$/, '$1'),
    };
  }

  function start(loaded) {
    data = loaded;
    Store.onChanged((changes, area) => {
      Store.applyChanges(data, area, changes);
      schedulePaint();
    });
    if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(onMessage);

    observer = new MutationObserver(() => schedulePaint());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-is-streaming'] });

    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    window.addEventListener('popstate', checkUrl);
    window.addEventListener('resize', positionPill);
    // Typing: reposition right away and again once the editor has finished re-rendering.
    document.addEventListener('input', () => {
      positionPill();
      setTimeout(positionPill, 0);
    }, true);
    document.addEventListener('scroll', positionPill, true);
    if (globalThis.navigation && navigation.addEventListener) {
      navigation.addEventListener('navigatesuccess', () => setTimeout(checkUrl, 0));
    }

    timers.push(setInterval(tick, TICK_MS));
    timers.push(setInterval(() => safe(refreshConversationList()), LIST_REFRESH_MS));
    setTimeout(() => safe(refreshConversationList()), 1500);
    tick();
    paint();
  }

  Store.loadAll().then(start).catch(() => start(Store.emptyState()));
})();
