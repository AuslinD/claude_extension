// Breakdown page: where your claude.ai time went (prompting / waiting / reading), plus tracking controls.
// Everything is rendered from scratch into #app on each change, so test/stats-fixture.html can load it as is.
(() => {
  'use strict';
  const { activity: Act, storage: Store } = globalThis.CCC;
  const TEST = globalThis.CCC_TEST || null;
  const now = () => (TEST && TEST.now) || Date.now();
  const fmt = Act.formatDuration;
  const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']];
  const IDLE_CHOICES = [[30, '30 s'], [60, '1 min'], [90, '90 s'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']];
  const ALL_KINDS = Act.KINDS.concat('idle');
  const MAX_CHATS = 50;

  let range = 'today';
  try { range = localStorage.getItem('ccc-range') || range; } catch (e) { /* storage blocked */ }
  if (!RANGES.some(([r]) => r === range)) range = 'today';

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') Object.assign(e.style, v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c != null) e.append(c);
    return e;
  }

  const swatch = (kind) => el('span', { className: 'sw', style: { background: `var(--${kind})` } });

  // ---------- data ----------

  async function load() {
    const t = now();
    const span = Act.rangeFor(range, t);
    const [segs, local, { settings }] = await Promise.all([
      Store.loadSegments(span.from, span.to),
      chrome.storage.local.get(['titles', 'pause']),
      chrome.storage.sync.get('settings'),
    ]);
    return {
      t, span, segs,
      sum: Act.summarize(segs, span),
      cols: Act.buckets(segs, span),
      titles: local.titles || {},
      pause: local.pause || null,
      settings: { ...Store.DEFAULT_SETTINGS, ...(settings || {}) },
    };
  }

  // ---------- sections ----------

  function header() {
    const group = el('div', { className: 'range', role: 'group', 'aria-label': 'Time range' });
    for (const [key, label] of RANGES) {
      group.append(el('button', {
        type: 'button', textContent: label, dataset: { range: key }, 'aria-pressed': String(key === range),
        onclick: () => {
          range = key;
          try { localStorage.setItem('ccc-range', key); } catch (e) { /* storage blocked */ }
          render();
        },
      }));
    }
    return el('header', { className: 'top' }, [el('h1', { textContent: 'Time on Claude' }), group]);
  }

  function hero(d) {
    const idle = d.sum.kinds.idle;
    return el('section', { className: 'card' }, [
      el('div', { className: 'hero-label', textContent: 'Time tracked' }),
      el('div', { className: 'hero-num', id: 'hero-total', textContent: fmt(d.sum.total) }),
      el('div', { id: 'hero-sub', textContent: idle ? `Leaves out ${fmt(idle)} idle (tab open, no input)` : 'No idle time left out' }),
    ]);
  }

  function split(d) {
    const rows = Act.splitRows(d.sum.kinds);
    const bar = el('div', { className: 'split', id: 'split' });
    if (!d.sum.total) bar.append(el('div', { className: 'split-empty' }));
    for (const r of rows) {
      if (!r.ms) continue;
      bar.append(el('div', {
        className: 'split-seg', dataset: { kind: r.kind },
        style: { flex: String(r.ms), background: `var(--${r.kind})` },
        onmouseover: (e) => showTip(e, r.label, [[r.kind, fmt(r.ms) + ' · ' + r.pct + '%']]),
        onmouseout: hideTip,
      }));
    }
    const legend = el('ul', { className: 'legend', id: 'legend' }, rows.map((r) =>
      el('li', { dataset: { kind: r.kind } }, [
        swatch(r.kind),
        el('span', { textContent: r.label }),
        el('span', { className: 'dur', textContent: fmt(r.ms) }),
        el('span', { className: 'pct', textContent: r.pct + '%' }),
      ])));
    return el('section', { className: 'card' }, [el('h2', { textContent: 'Split' }), bar, legend]);
  }

  // Smallest "nice" step giving at most 4 gridlines above zero.
  function axis(max) {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720].map((m) => m * 60000);
    const step = steps.find((s) => Math.ceil(max / s) <= 4) || steps[steps.length - 1];
    const n = Math.max(1, Math.ceil(max / step));
    return { step, top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
  }

  // Axis ticks are whole steps, so "1h" reads better than "1h 00m".
  const tickLabel = (v) => (!v ? '0' : v % 3600000 === 0 ? v / 3600000 + 'h' : fmt(v));

  function chart(d) {
    const { list, unit, max } = d.cols;
    const ax = axis(max);
    const yaxis = el('div', { className: 'yaxis' }, ax.ticks.map((v) =>
      el('span', { textContent: tickLabel(v), style: { bottom: `calc(20px + (100% - 20px) * ${v / ax.top})` } })));
    const bars = el('div', { className: 'bars' });
    for (const v of ax.ticks.slice(1)) bars.append(el('div', { className: 'gridline', style: { bottom: (v / ax.top) * 100 + '%' } }));
    const xlabels = el('div', { className: 'xlabels' });
    const every = unit === 'hour' ? 3 : list.length > 10 ? 5 : 1;
    list.forEach((b, i) => {
      const stack = el('div', { className: 'stack' });
      for (const k of Act.KINDS) {
        if (!b.kinds[k]) continue;
        stack.append(el('div', { className: 'col-seg', dataset: { kind: k }, style: { height: (b.kinds[k] / ax.top) * 100 + '%', background: `var(--${k})` } }));
      }
      stack.style.height = (b.total / ax.top) * 100 + '%';
      // Heights are shares of the column; re-normalize so the 2px gaps don't overflow the stack.
      for (const seg of stack.children) seg.style.height = (b.kinds[seg.dataset.kind] / (b.total || 1)) * 100 + '%';
      bars.append(el('div', {
        className: 'col', dataset: { key: b.key, label: b.label },
        onmouseover: (e) => showTip(e, `${b.label} · ${fmt(b.total)} tracked`,
          Act.KINDS.map((k) => [k, fmt(b.kinds[k])]).concat(b.kinds.idle ? [['idle', fmt(b.kinds.idle)]] : [])),
        onmousemove: moveTip,
        onmouseout: hideTip,
      }, stack));
      xlabels.append(el('span', { textContent: i % every === 0 || i === list.length - 1 ? b.label : '' }));
    });
    const plot = el('div', { className: 'plot' }, [bars, xlabels]);
    const key = el('div', { className: 'chart-key' }, Act.KINDS.map((k) => el('span', {}, [swatch(k), Act.LABELS[k]])));
    return el('section', { className: 'card' }, [
      el('div', { className: 'chart-head' }, [el('h2', { textContent: unit === 'hour' ? 'By hour' : 'By day' }), key]),
      el('div', { className: 'chart', id: 'chart', role: 'img', 'aria-label': 'Stacked columns of tracked time; the same numbers are in the tables below' }, [yaxis, plot]),
    ]);
  }

  function activityTable(d) {
    const rows = Act.splitRows(d.sum.kinds);
    const tbody = el('tbody', {}, rows.map((r) => el('tr', { dataset: { kind: r.kind } }, [
      el('td', {}, el('span', { className: 'kind-cell' }, [swatch(r.kind), r.label])),
      el('td', { className: 'num', textContent: fmt(r.ms) }),
      el('td', { className: 'num', textContent: r.pct + '%' }),
    ])));
    tbody.append(el('tr', { className: 'muted', dataset: { kind: 'idle' } }, [
      el('td', {}, el('span', { className: 'kind-cell' }, [swatch('idle'), Act.LABELS.idle])),
      el('td', { className: 'num', textContent: fmt(d.sum.kinds.idle) }),
      el('td', { className: 'num', textContent: '—' }),
    ]));
    return el('section', { className: 'card' }, [
      el('h2', { textContent: 'By activity' }),
      el('table', { id: 'by-activity' }, [
        el('thead', {}, el('tr', {}, [el('th', { textContent: 'Activity' }), el('th', { className: 'num', textContent: 'Time' }), el('th', { className: 'num', textContent: 'Share' })])),
        tbody,
      ]),
    ]);
  }

  function chatTable(d) {
    const rows = Object.entries(d.sum.byChat)
      .filter(([, v]) => v.total > 0)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, MAX_CHATS);
    const name = (id) => (id ? d.titles[id] || 'Chat ' + id.slice(0, 8) : 'Other pages');
    const tbody = el('tbody', {}, rows.map(([id, v]) => el('tr', {}, [
      el('td', { className: 'name', title: name(id) },
        id ? el('a', { href: 'https://claude.ai/chat/' + id, target: '_blank', rel: 'noopener', textContent: name(id) }) : name(id)),
      ...Act.KINDS.map((k) => el('td', { className: 'num', textContent: v[k] ? fmt(v[k]) : '–' })),
      el('td', { className: 'num', textContent: fmt(v.total) }),
    ])));
    const table = el('table', { id: 'by-chat' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { textContent: 'Chat' }),
        ...Act.KINDS.map((k) => el('th', { className: 'num', textContent: Act.LABELS[k] })),
        el('th', { className: 'num', textContent: 'Total' }),
      ])),
      tbody,
    ]);
    return el('section', { className: 'card' }, [
      el('h2', { textContent: 'By chat' }),
      rows.length ? el('div', { className: 'table-scroll' }, table) : el('div', { className: 'empty', textContent: 'No time tracked in this range yet.' }),
    ]);
  }

  function controls(d) {
    const paused = Act.isPaused(d.pause, d.t);
    const on = d.settings.tracking;
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const status = !on ? 'Tracking is off' : paused ? (d.pause.until ? 'Paused until ' + clock(d.pause.until) : 'Paused until you resume') : 'Counting';

    const idle = el('select', { id: 'opt-idle', onchange: (e) => Store.saveSettings({ idleSeconds: Number(e.target.value) }) },
      IDLE_CHOICES.map(([v, label]) => el('option', { value: String(v), textContent: label, selected: v === d.settings.idleSeconds })));

    return el('section', { className: 'card' }, [
      el('h2', { textContent: 'Tracking' }),
      el('div', { className: 'controls' }, [
        el('div', { className: 'row' }, [
          el('span', { className: 'status', id: 'pause-status', textContent: status }),
          el('button', { className: 'btn', id: 'pause-btn', type: 'button', textContent: paused ? 'Resume' : 'Pause', disabled: !on,
            onclick: () => Store.togglePause(now()) }),
          el('button', { className: 'btn', id: 'discard-btn', type: 'button', textContent: 'Discard last 10 min',
            title: 'That wasn’t me: remove the last 10 minutes of tracked time',
            onclick: () => Store.discardTime(now() - 10 * 60000, now()) }),
        ]),
        el('label', { className: 'row' }, [
          el('input', { type: 'checkbox', id: 'opt-tracking', checked: on, onchange: (e) => Store.saveSettings({ tracking: e.target.checked }) }),
          'Track time on claude.ai',
        ]),
        el('label', { className: 'row' }, ['Count as idle after no mouse, scroll or keyboard input for', idle]),
        el('div', { className: 'hint' }, [
          'Only counts while a claude.ai tab is in front and the window is focused. Pause from anywhere with ',
          el('b', { textContent: 'Alt+Shift+P' }), ' (change it at ', el('code', { textContent: 'chrome://extensions/shortcuts' }), '). ',
          'Stored on this device only; days older than 60 are deleted.',
        ]),
        el('div', { className: 'row' }, el('button', { className: 'btn danger', id: 'delete-btn', type: 'button', textContent: 'Delete all time data',
          onclick: async () => {
            if (!confirm('Delete all tracked time? This can’t be undone.')) return;
            await Store.clearTime();
            render();
          } })),
      ]),
    ]);
  }

  // ---------- tooltip ----------

  function tooltip() {
    return document.getElementById('tooltip') || document.body.appendChild(el('div', { id: 'tooltip', role: 'tooltip', hidden: true }));
  }

  function showTip(e, head, rows) {
    const tip = tooltip();
    tip.replaceChildren(el('div', { className: 'tt-head', textContent: head }),
      ...rows.map(([k, v]) => el('div', { className: 'tt-row' }, [swatch(k), Act.LABELS[k], el('b', { textContent: v })])));
    tip.hidden = false;
    moveTip(e);
  }

  function moveTip(e) {
    const tip = tooltip();
    if (tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = e.clientX + 14 + w > innerWidth ? e.clientX - w - 14 : e.clientX + 14;
    const y = e.clientY + 14 + h > innerHeight ? e.clientY - h - 14 : e.clientY + 14;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }

  function hideTip() {
    tooltip().hidden = true;
  }

  // ---------- render loop ----------

  let rendering = null;
  async function render() {
    const d = await load();
    const app = document.getElementById('app');
    app.replaceChildren(
      header(),
      el('div', { className: 'grid2' }, [hero(d), split(d)]),
      chart(d),
      el('div', { className: 'grid2' }, [activityTable(d), controls(d)]),
      chatTable(d),
    );
  }

  function renderSoon() {
    clearTimeout(rendering);
    rendering = setTimeout(render, 150);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    const keys = Object.keys(changes);
    if (area === 'sync' ? keys.includes('settings') : keys.some((k) => k.startsWith('time:') || k === 'pause' || k === 'titles')) renderSoon();
  });
  setInterval(renderSoon, 30000); // "today" keeps moving, and timed pauses run out
  render();
})();
