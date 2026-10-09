// Drives stats-fixture.html (the breakdown page on seeded data) and writes snapshots to <pre id="results">.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const R = {};

  function snap() {
    return {
      hero: $('#hero-total') && $('#hero-total').textContent,
      heroSub: $('#hero-sub') && $('#hero-sub').textContent,
      legend: $$('#legend [data-kind]').map((li) => [li.dataset.kind, li.querySelector('.dur').textContent, li.querySelector('.pct').textContent]),
      splitKinds: $$('#split .split-seg').map((s) => s.dataset.kind),
      columns: $$('#chart .col').map((c) => ({ label: c.dataset.label, kinds: Array.from(c.querySelectorAll('.col-seg')).map((s) => s.dataset.kind) })),
      activityRows: $$('#by-activity tbody tr').map((tr) => [tr.dataset.kind, tr.cells[1].textContent]),
      chatRows: $$('#by-chat tbody tr').map((tr) => [tr.cells[0].textContent, tr.cells[tr.cells.length - 1].textContent]),
      pressed: $$('.range button[aria-pressed="true"]').map((b) => b.dataset.range),
    };
  }

  try {
    await sleep(500);
    R.today = snap();

    $('.range button[data-range="7d"]').click();
    await sleep(300);
    R.week = snap();

    $('.range button[data-range="30d"]').click();
    await sleep(300);
    R.month = snap();

    // Hovering a column shows a tooltip with that column's numbers.
    const col = $$('#chart .col').pop();
    col.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 }));
    await sleep(50);
    R.tooltip = $('#tooltip') && !$('#tooltip').hidden ? $('#tooltip').textContent : null;

    // Live: new time arriving from a claude.ai tab updates the page.
    $('.range button[data-range="today"]').click();
    await sleep(200);
    const at = (h, m) => new Date(2026, 9, 9, h, m).getTime();
    const list = (await chrome.storage.local.get('time:2026-10-09'))['time:2026-10-09'];
    await chrome.storage.local.set({ 'time:2026-10-09': list.concat([{ id: 'z', chatId: 'c2', kind: 'reading', start: at(14, 40), end: at(14, 50) }]) });
    await sleep(600);
    R.live = snap();

    // Settings and controls
    // (The page re-renders after every change, so always query elements fresh.)
    $('#opt-tracking').click();
    await sleep(200);
    R.trackingSetting = (await chrome.storage.sync.get('settings')).settings.tracking;
    $('#opt-tracking').click();
    await sleep(200);

    const idle = $('#opt-idle');
    idle.value = '60';
    idle.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    R.idleSetting = (await chrome.storage.sync.get('settings')).settings.idleSeconds;

    $('#pause-btn').click();
    await sleep(300);
    R.pause = (await chrome.storage.local.get('pause')).pause || null;
    R.pauseStatus = $('#pause-status').textContent;
    $('#pause-btn').click();
    await sleep(300);
    R.pauseAfterResume = (await chrome.storage.local.get('pause')).pause || null;

    $('#delete-btn').click();
    await sleep(400);
    R.timeKeysAfterDelete = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('time:'));
    R.afterDelete = snap();
  } catch (e) {
    R.error = String((e && e.stack) || e);
  }

  const pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = JSON.stringify(R);
  document.body.appendChild(pre);
})();
