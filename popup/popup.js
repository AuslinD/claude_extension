(() => {
  'use strict';
  const { colors: Colors, storage: Store, paletteUI } = globalThis.CCC;
  const $ = (s) => document.querySelector(s);
  let target = null; // 'chat' | 'project' for the current chat's picker
  let lastInfo = null;

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e[k] = v;
    }
    for (const c of children) e.append(c);
    return e;
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async function getInfo() {
    try {
      const tab = await activeTab();
      return tab ? await chrome.tabs.sendMessage(tab.id, { type: 'ccc:getInfo' }) : null;
    } catch (e) {
      return null; // not a claude.ai tab (no content script)
    }
  }

  async function openChat(id) {
    const url = 'https://claude.ai/chat/' + id;
    const tab = await activeTab();
    if (tab && lastInfo) await chrome.tabs.update(tab.id, { url });
    else await chrome.tabs.create({ url });
    window.close();
  }

  // ---------- this chat ----------

  async function renderCurrent() {
    const box = $('#current');
    const [info, { recentColors }] = await Promise.all([getInfo(), chrome.storage.sync.get('recentColors')]);
    lastInfo = info;
    box.replaceChildren();
    if (!info || !info.chatId) {
      box.append(el('div', {
        className: 'empty',
        textContent: info ? 'Open a chat on claude.ai to color it.' : 'Go to claude.ai in this tab to color a chat. (Already there? Reload the page once after installing.)',
      }));
      return;
    }
    if (!target) target = info.projectId && !info.hasOverride ? 'project' : 'chat';

    box.append(el('div', { className: 'current' }, [
      el('div', { className: 'big', style: { background: info.color } }),
      el('div', { style: { minWidth: '0' } }, [
        el('div', { className: 'title', textContent: info.title }),
        el('div', { className: 'sub', textContent: info.description }),
      ]),
    ]));

    if (info.projectId) {
      const seg = el('div', { className: 'seg' });
      for (const [val, label] of [['chat', 'This chat'], ['project', 'Whole project']]) {
        seg.append(el('button', { textContent: label, className: target === val ? 'on' : '', onclick: () => { target = val; renderCurrent(); } }));
      }
      box.append(seg);
    }

    box.append(paletteUI.buildPalette(document, {
      selected: info.base,
      recent: recentColors || [],
      onPick: async (hex) => {
        if (target === 'project' && info.projectId) {
          await Store.setProjectColor(info.projectId, hex);
          await Store.clearChatColor(info.chatId);
        } else {
          await Store.setChatColor(info.chatId, hex);
        }
        await Store.pushRecent(hex);
      },
    }));

    const actions = el('div', { className: 'row' });
    if (info.hasOverride) actions.append(el('button', { className: 'act', textContent: 'Reset this chat', onclick: () => Store.clearChatColor(info.chatId) }));
    if (info.hasProjectOverride) actions.append(el('button', { className: 'act', textContent: 'Reset project', onclick: () => Store.clearProjectColor(info.projectId) }));
    if (actions.childNodes.length) box.append(actions);
  }

  // ---------- activity (running / finished-unopened) ----------

  async function renderActivity() {
    const local = await chrome.storage.local.get(null);
    const titles = local.titles || {};
    const rows = [];
    for (const [key, e] of Object.entries(local)) {
      if (!key.startsWith('status:') || !e) continue;
      const id = key.slice(7);
      if (e.state === 'done' && e.unseen) rows.push({ id, kind: 'done', t: e.finishedAt || 0, uncertain: e.uncertain });
      else if (e.state === 'running') rows.push({ id, kind: 'run', t: e.startedAt || 0 });
    }
    $('#activity-section').hidden = !rows.length;
    const list = $('#activity');
    list.replaceChildren();
    rows.sort((a, b) => (a.kind === b.kind ? b.t - a.t : a.kind === 'done' ? -1 : 1));
    for (const r of rows) {
      list.append(el('li', { className: 'clickable', title: 'Open this chat', onclick: () => openChat(r.id) }, [
        el('span', { className: 'badge ' + r.kind, textContent: r.kind === 'done' ? (r.uncertain ? '✓ Done?' : '✓ Done') : 'Running' }),
        el('span', { className: 'name', textContent: titles[r.id] || 'Chat ' + r.id.slice(0, 8) }),
        el('span', { className: 'meta', textContent: ago(r.t) }),
      ]));
    }
  }

  function ago(t) {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  // ---------- settings ----------

  async function renderSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    const s = { ...Store.DEFAULT_SETTINGS, ...(settings || {}) };
    for (const cb of document.querySelectorAll('input[data-setting]')) {
      cb.checked = !!s[cb.dataset.setting];
      cb.onchange = () => Store.saveSettings({ [cb.dataset.setting]: cb.checked });
    }
  }

  // ---------- custom colors ----------

  async function renderCustom() {
    const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(['titles', 'projectMap'])]);
    const titles = local.titles || {};
    const projectChats = {};
    for (const [cid, pid] of Object.entries(local.projectMap || {})) if (pid) (projectChats[pid] = projectChats[pid] || []).push(cid);
    const rows = [];
    for (const [key, color] of Object.entries(sync)) {
      if (key.startsWith('color:')) {
        const id = key.slice(6);
        rows.push({ key, color, name: titles[id] || 'Chat ' + id.slice(0, 8), what: 'chat' });
      } else if (key.startsWith('pcolor:')) {
        const n = (projectChats[key.slice(7)] || []).length;
        rows.push({ key, color, name: `Project (${n} chat${n === 1 ? '' : 's'} known)`, what: 'project' });
      }
    }
    const list = $('#custom');
    list.replaceChildren();
    if (!rows.length) {
      list.append(el('li', { className: 'empty', textContent: 'None yet — every chat gets an automatic color until you pick one.' }));
      return;
    }
    rows.sort((a, b) => (a.what === b.what ? a.name.localeCompare(b.name) : a.what === 'project' ? -1 : 1));
    for (const r of rows) {
      list.append(el('li', {}, [
        el('span', { className: 'dot', style: { background: r.color } }),
        el('span', { className: 'name', textContent: r.name, title: r.name }),
        el('span', { className: 'meta', textContent: Colors.nameFor(r.color) }),
        el('button', { className: 'x', textContent: '×', title: 'Go back to the automatic color', onclick: () => chrome.storage.sync.remove(r.key) }),
      ]));
    }
  }

  // ---------- footer ----------

  $('#version').textContent = 'v' + chrome.runtime.getManifest().version;
  $('#mark-seen').addEventListener('click', () => Store.markAllSeen());
  $('#diag').addEventListener('click', async () => {
    const info = await getInfo();
    const report = {
      extension: chrome.runtime.getManifest().version,
      onClaudeTab: !!info,
      ...(info ? info.diagnostics : {}),
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    $('#diag').textContent = 'Copied — paste it into a GitHub issue';
  });

  let pending = null;
  function renderAll() {
    clearTimeout(pending);
    pending = setTimeout(() => {
      renderCurrent();
      renderActivity();
      renderSettings();
      renderCustom();
    }, 60);
  }

  // Status heartbeats arrive every couple of seconds while Claude is answering; only refresh the
  // activity list for those so the color picker isn't rebuilt under your mouse.
  chrome.storage.onChanged.addListener((changes, area) => {
    const keys = Object.keys(changes);
    if (area === 'local' && keys.every((k) => k.startsWith('status:') || k === 'auto')) renderActivity();
    else renderAll();
  });
  renderAll();
})();
