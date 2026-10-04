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
  } catch (e) {
    R.error = String((e && e.stack) || e);
  }

  const pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = JSON.stringify(R);
  document.body.appendChild(pre);
})();
