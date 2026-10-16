// Drives the fixture through a scripted scenario and writes snapshots to <pre id="results">.
// Run headless via test/dom.test.js, or open fixture.html in Chrome and read the box at the bottom.
(async () => {
  const ids = window.CCC_IDS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fieldset = document.querySelector('fieldset');
  const R = {};

  function snap() {
    const links = {};
    for (const k of ['A', 'B', 'C', 'D']) {
      const a = document.getElementById('link-' + k);
      links[k] = {
        color: a.style.getPropertyValue('--ccc-c') || null,
        status: a.getAttribute('data-ccc-status'),
        current: a.hasAttribute('data-ccc-current'),
      };
    }
    const top = document.getElementById('ccc-topbar');
    const pill = document.getElementById('ccc-pill');
    return {
      links,
      msgLinkPainted: document.getElementById('msg-link').hasAttribute('data-ccc-id'),
      rootColor: document.documentElement.style.getPropertyValue('--ccc-color').trim(),
      topbar: !!top && !top.hidden,
      pill: pill && !pill.hidden ? pill.textContent : null,
      composerMarked: fieldset.hasAttribute('data-ccc-composer'),
    };
  }

  function stopButton() {
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'Stop response');
    return b;
  }

  try {
    await sleep(1500);
    R.initial = snap();

    // 0. Typing grows the message box upward without adding elements; the label must follow its top edge.
    const editor = document.querySelector('.ProseMirror');
    const pillOffset = () => {
      const p = document.getElementById('ccc-pill').getBoundingClientRect();
      return Math.round(p.top + p.height / 2 - fieldset.getBoundingClientRect().top);
    };
    R.pillBefore = { offset: pillOffset(), boxTop: Math.round(fieldset.getBoundingClientRect().top) };
    editor.style.minHeight = '200px';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await sleep(300);
    R.pillAfterGrow = { offset: pillOffset(), boxTop: Math.round(fieldset.getBoundingClientRect().top) };
    editor.style.minHeight = '';
    await sleep(300);

    // 1. Start a response in chat A
    let stop = stopButton();
    fieldset.appendChild(stop);
    await sleep(2000);
    R.streaming = snap();

    // 2. It finishes while the user is in another window -> green dot
    CCC_TEST.viewing = false;
    stop.remove();
    await sleep(1500);
    R.doneUnseen = snap();

    // 3. User comes back -> dot clears
    CCC_TEST.viewing = true;
    await sleep(1500);
    R.viewed = snap();

    // 4. Start again, then navigate to chat B mid-response
    stop = stopButton();
    fieldset.appendChild(stop);
    await sleep(1500);
    stop.remove();
    CCC_TEST.path = '/chat/' + ids.B;
    document.title = 'Beta chat - Claude';
    await sleep(1500);
    R.awayRunning = snap();

    // 5. No tab watches A and the API is unreachable -> fallback "uncertain" marker
    await sleep(8000);
    R.awayExpired = snap();

    // 6. A custom color (as the popup would write it) applies everywhere immediately
    await chrome.storage.sync.set({ ['color:' + ids.B]: '#123456' });
    await sleep(800);
    R.override = snap();

    // 7. Inline picker opens from the pill; picking "Purple" recolors the chat and remembers it as recent
    document.getElementById('ccc-pill').click();
    await sleep(300);
    const picker = document.getElementById('ccc-picker');
    R.pickerOpen = !!picker;
    R.pickerSwatches = picker ? picker.querySelectorAll('.ccc-pal-grid .ccc-pal-swatch').length : 0;
    R.pickerHasProjectToggle = !!(picker && picker.querySelector('.ccc-seg'));
    const purple = picker && picker.querySelector('.ccc-pal-grid [aria-label="Purple"]');
    if (purple) purple.click();
    await sleep(500);
    R.afterPick = snap();
    R.pickerDescription = (document.querySelector('#ccc-picker .ccc-src') || {}).textContent || null;
    R.recent = (await chrome.storage.sync.get('recentColors')).recentColors || [];
    R.pickerRecentSwatches = document.querySelectorAll('#ccc-picker .ccc-pal-row .ccc-pal-swatch').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(300);
    R.pickerClosed = !document.getElementById('ccc-picker');

    // 8. Alt+click on a project chat opens a picker with a "This chat / Whole project" switch,
    //    defaulting to the whole project; picking Orange recolors both project chats.
    document.getElementById('link-D').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, clientX: 50, clientY: 50 }));
    await sleep(300);
    const p2 = document.getElementById('ccc-picker');
    R.projectPickerToggle = p2 ? Array.from(p2.querySelectorAll('.ccc-seg button')).map((b) => b.textContent + (b.className ? '*' : '')) : null;
    const orange = p2 && p2.querySelector('.ccc-pal-grid [aria-label="Orange"]');
    if (orange) orange.click();
    await sleep(500);
    R.projectRecolor = snap();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(200);

    // 9. Turning the sidebar off removes the stripes
    await chrome.storage.sync.set({ settings: { sidebar: false } });
    await sleep(800);
    R.sidebarOff = snap();

    // 9b. A subagent finishing in another chat shows a toast; one in the chat you're looking at is marked read
    const entry = (chatId, task) => ({ chatId, projectId: null, name: 'agent', task, summary: 'Found 3 sources.', isError: false, finishedAt: Date.now(), unread: true });
    await chrome.storage.local.set({ inbox: { tu1: entry(ids.A, 'Research flights') } });
    await sleep(300);
    const toast = document.getElementById('ccc-toast');
    R.toast = toast && !toast.hidden ? toast.textContent : null;
    await chrome.storage.local.set({ inbox: { ...(await chrome.storage.local.get('inbox')).inbox, tu2: entry(ids.B, 'Summarize PDF') } });
    await sleep(1500);
    const inbox = (await chrome.storage.local.get('inbox')).inbox;
    R.inboxUnread = { A: inbox.tu1.unread, B: inbox.tu2.unread };

    // 10. Time tracking. Each phase is measured as the change in stored totals (segments are
    //     flushed every 500 ms in the fixture).
    const kinds = async () => {
      const segs = await CCC.storage.loadSegments(0, Date.now(), { all: true });
      return CCC.activity.summarize(segs).kinds;
    };
    const poke = () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const type = () => editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const diff = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, b[k] - a[k]]));
    const T = (R.time = {});
    poke();
    await sleep(1000);
    let k = await kinds();

    for (let i = 0; i < 6; i++) { type(); await sleep(300); } // typing in the message box
    await sleep(700);
    let k2 = await kinds(); T.typing = diff(k, k2); k = k2;

    stop = stopButton(); // Claude answers; you just watch
    fieldset.appendChild(stop);
    await sleep(2500);
    stop.remove();
    await sleep(700);
    k2 = await kinds(); T.waiting = diff(k, k2); k = k2;

    for (let i = 0; i < 7; i++) { poke(); await sleep(300); } // scrolling through the answer
    await sleep(600);
    k2 = await kinds(); T.reading = diff(k, k2); k = k2;

    await chrome.storage.sync.set({ settings: { sidebar: false, idleSeconds: 2 } }); // no input for 2 s -> idle
    await sleep(5000);
    k2 = await kinds(); T.idle = diff(k, k2); k = k2;

    CCC_TEST.viewing = false; // other window: input here doesn't count
    poke(); type();
    await sleep(2000);
    k2 = await kinds(); T.away = diff(k, k2); k = k2;

    await chrome.storage.local.set({ pause: { since: Date.now(), until: null } });
    await sleep(100);
    CCC_TEST.viewing = true;
    for (let i = 0; i < 5; i++) { poke(); await sleep(300); }
    await sleep(600);
    k2 = await kinds(); T.paused = diff(k, k2); k = k2;
    T.pillPaused = document.getElementById('ccc-pill').hasAttribute('data-ccc-paused');

    await chrome.storage.local.remove('pause');
    for (let i = 0; i < 10; i++) { poke(); await sleep(300); }
    await sleep(600);
    k2 = await kinds(); T.resumed = diff(k, k2); k = k2;
    T.pillPausedAfterResume = document.getElementById('ccc-pill').hasAttribute('data-ccc-paused');

    // "Discard last N" while this tab has an unsaved open segment: it must not come back.
    for (let i = 0; i < 4; i++) { poke(); await sleep(300); }
    await CCC.storage.discardTime(Date.now() - 4000, Date.now());
    CCC_TEST.viewing = false; // stop counting so only a resurrected segment could change the totals
    await sleep(100);
    T.discardBefore = k;
    T.discardRightAfter = await kinds();
    await sleep(1500);
    T.discardLater = await kinds();
    CCC_TEST.viewing = true;
  } catch (e) {
    R.error = String((e && e.stack) || e);
  }

  const pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = JSON.stringify(R);
  document.body.appendChild(pre);
})();
