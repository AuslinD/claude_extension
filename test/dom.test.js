// Runs test/fixture.html in headless Chrome (virtual time, so ~20s of scenario runs instantly)
// and checks the snapshots it produces. Skipped when Chrome isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const Colors = require('../src/colors.js');

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));

// Chrome dumps the DOM once the virtual-time budget is spent but may not exit while timers
// are still scheduled, so read stdout until </html> and then kill it.
function runFixture() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-chrome-'));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), // GitHub Actions runners
    '--virtual-time-budget=40000', '--dump-dom',
    pathToFileURL(path.join(__dirname, 'fixture.html')).href,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('exit', () => {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* temp dir */ }
  });
  const cleanup = () => child.kill('SIGKILL');
  return new Promise((resolve, reject) => {
    let html = '';
    const timer = setTimeout(() => { cleanup(); reject(new Error('headless Chrome timed out')); }, 90000);
    child.stdout.on('data', (d) => {
      html += d;
      if (!html.includes('</html>')) return;
      clearTimeout(timer);
      cleanup();
      const m = /<pre id="results">([\s\S]*?)<\/pre>/.exec(html);
      if (!m) return reject(new Error('fixture produced no results block'));
      const text = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      resolve(JSON.parse(text));
    });
    child.on('error', (e) => { clearTimeout(timer); cleanup(); reject(e); });
  });
}

test('fixture scenario in headless Chrome', { skip: !CHROME && 'Chrome not found' }, async () => {
  const R = await runFixture();
  assert.equal(R.error, undefined, R.error);

  // Initial paint
  const i = R.initial;
  assert.ok(i.topbar, 'top bar shown');
  assert.ok(i.composerMarked, 'composer glow');
  assert.match(i.pill, /Alpha chat/, 'pill shows chat title');
  for (const k of ['A', 'B', 'C', 'D']) assert.match(i.links[k].color || '', /^#[0-9a-f]{6}$/, `link ${k} colored`);
  assert.equal(i.links.A.color, Colors.autoColor(0), 'first chat seen gets the first automatic color (red)');
  assert.equal(i.links.B.color, Colors.autoColor(1), 'next chat gets the next one (blue)');
  assert.equal(i.rootColor, i.links.A.color, 'page color matches current chat');
  assert.ok(i.links.A.current && !i.links.B.current, 'current chat highlighted');
  assert.equal(i.msgLinkPainted, false, 'links inside messages are not painted');

  // Project: same color family, older chat visibly faded
  const projectBase = Colors.autoColor(2);
  assert.equal(i.links.C.color, projectBase, 'newest project chat = full project color');
  assert.equal(i.links.D.color, Colors.blend(projectBase, '#ffffff', Colors.FADE[2]), '3rd newest = faded');
  assert.ok(Colors.deltaE(i.links.C.color, i.links.D.color) > 15, 'project siblings are visibly different');

  // Status lifecycle
  assert.equal(R.streaming.links.A.status, 'running');
  assert.equal(R.doneUnseen.links.A.status, 'done', 'finished while away -> highlighted');
  assert.equal(R.viewed.links.A.status, null, 'highlight clears once viewed');
  assert.equal(R.awayRunning.links.A.status, 'running', 'still running after navigating away');
  assert.ok(R.awayRunning.links.B.current);
  assert.match(R.awayRunning.pill, /Beta chat/);
  assert.equal(R.awayExpired.links.A.status, 'uncertain');
  assert.equal(R.awayExpired.links.B.status, null);

  // Overrides
  assert.equal(R.override.links.B.color, '#123456');
  assert.equal(R.override.rootColor, '#123456');

  // Picker
  assert.ok(R.pickerOpen && R.pickerClosed, 'picker opens from pill and closes on Escape');
  assert.equal(R.pickerSwatches, 57);
  assert.equal(R.pickerHasProjectToggle, false, 'no project switch for a non-project chat');
  assert.equal(R.afterPick.links.B.color, '#a855f7');
  assert.equal(R.afterPick.rootColor, '#a855f7');
  assert.equal(R.pickerDescription, 'Purple \u00b7 picked by you');
  assert.deepEqual(R.recent, ['#a855f7']);
  assert.equal(R.pickerRecentSwatches, 1, 'recent row shows the picked color');

  // Project picker defaults to the whole project
  assert.deepEqual(R.projectPickerToggle, ['This chat', 'Whole project*']);
  assert.equal(R.projectRecolor.links.C.color, '#f97316', 'whole project recolored (newest = full orange)');
  assert.equal(R.projectRecolor.links.D.color, Colors.blend('#f97316', '#ffffff', Colors.FADE[2]));

  // Settings
  assert.equal(R.sidebarOff.links.A.color, null);
  assert.equal(R.sidebarOff.links.A.status, null);
  assert.ok(R.sidebarOff.topbar, 'top bar unaffected by sidebar toggle');
});
