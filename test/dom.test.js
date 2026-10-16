// Runs test/fixture.html in headless Chrome (virtual time, so ~45s of scenario runs in a few seconds)
// and checks the snapshots it produces. Skipped when Chrome isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const Colors = require('../src/colors.js');
const { CHROME, runPage } = require('./headless.js');

const runFixture = () => runPage('fixture.html', 70000);

test('fixture scenario in headless Chrome', { skip: !CHROME && 'Chrome not found' }, async () => {
  const R = await runFixture();
  if (process.env.DEBUG_FIXTURE) console.log(JSON.stringify(R, null, 1)); // DEBUG_FIXTURE=1 npm test
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

  // Label follows the message box as it grows while typing
  assert.ok(R.pillAfterGrow.boxTop < R.pillBefore.boxTop - 100, 'test setup: box actually grew upward');
  assert.ok(Math.abs(R.pillBefore.offset) <= 1, `label centered on box edge before (${R.pillBefore.offset}px)`);
  assert.ok(Math.abs(R.pillAfterGrow.offset) <= 1, `label still on box edge after growing (${R.pillAfterGrow.offset}px off)`);

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

  // Subagent inbox
  assert.match(R.toast || '', /Subagent finished.*Research flights.*Alpha chat/, 'toast announces the finished subagent');
  assert.deepEqual(R.inboxUnread, { A: true, B: false }, 'entries for the chat you are viewing are marked read');

  // Time tracking (fixture: typing grace 1.5 s; idle timeout set to 2 s in the idle phase)
  const T = R.time;
  const near = (ms, lo, hi, what) => assert.ok(ms >= lo && ms <= hi, `${what}: ${ms} ms not in [${lo}, ${hi}]`);
  near(T.typing.prompting, 1500, 3500, 'typing counts as prompting');
  near(T.typing.waiting + T.typing.idle, 0, 0, 'typing: nothing else');
  near(T.waiting.waiting, 2000, 3000, 'Claude generating counts as waiting');
  near(T.waiting.prompting, 0, 0, 'keystrokes that sent the prompt are not counted as prompting while waiting');
  near(T.reading.reading, 1500, 3500, 'scrolling around counts as reading');
  near(T.reading.prompting + T.reading.waiting + T.reading.idle, 0, 0, 'reading: nothing else');
  near(T.idle.idle, 2000, 5000, 'no input for the idle timeout -> idle');
  near(T.idle.reading, 0, 2500, 'reading stops after the idle timeout');
  for (const k of ['prompting', 'waiting', 'reading', 'idle']) {
    assert.equal(T.away[k], 0, `away: no ${k} counted while the window is unfocused`);
    assert.equal(T.paused[k], 0, `paused: no ${k} counted`);
  }
  assert.ok(T.pillPaused, 'label shows the paused marker');
  assert.ok(T.resumed.reading >= 2000, 'counting resumes after unpausing');
  assert.equal(T.pillPausedAfterResume, false);
  assert.ok(T.discardRightAfter.reading < T.discardBefore.reading, 'discard removed the last few seconds of reading');
  assert.equal(T.discardRightAfter.prompting, T.discardBefore.prompting, 'older time is kept');
  assert.deepEqual(T.discardLater, T.discardRightAfter, 'the open tab does not re-save discarded time');
});
