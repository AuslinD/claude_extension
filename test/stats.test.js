// Runs the breakdown page (stats/) on seeded data in headless Chrome. See test/stats-fixture.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, runPage } = require('./headless.js');

test('breakdown page in headless Chrome', { skip: !CHROME && 'Chrome not found' }, async () => {
  const R = await runPage('stats-fixture.html', 10000);
  if (process.env.DEBUG_FIXTURE) console.log(JSON.stringify(R, null, 1));
  assert.equal(R.error, undefined, R.error);

  // Today: c1 = 10m prompting + 5m waiting + 15m reading, other pages = 2m prompting,
  // c2 = 8m reading + 20m idle (not counted).
  const t = R.today;
  assert.deepEqual(t.pressed, ['today'], 'opens on Today');
  assert.equal(t.hero, '40m');
  assert.match(t.heroSub, /20m idle/);
  assert.deepEqual(t.legend, [['prompting', '12m', '30%'], ['waiting', '5m', '13%'], ['reading', '23m', '57%']]);
  assert.deepEqual(t.splitKinds, ['prompting', 'waiting', 'reading']);
  assert.equal(t.columns.length, 16, 'one column per hour, midnight to 3 pm');
  assert.equal(t.columns[13].label, '1 pm');
  assert.deepEqual(t.columns[13].kinds, ['prompting', 'waiting', 'reading'], 'stacked in fixed order');
  assert.deepEqual(t.columns[0].kinds, [], 'empty hour has no segments');
  assert.deepEqual(t.activityRows, [['prompting', '12m'], ['waiting', '5m'], ['reading', '23m'], ['idle', '20m']]);
  assert.deepEqual(t.chatRows, [['Linear algebra help', '30m'], ['OS lab', '8m'], ['Other pages', '2m']]);

  // 7 days adds Oct 7 (30m waiting in OS lab); 30 days also adds Oct 1 (1h reading).
  assert.equal(R.week.hero, '1h 10m');
  assert.equal(R.week.columns.length, 7);
  assert.equal(R.week.columns[6].label, 'Fri 9');
  assert.deepEqual(R.week.chatRows[0], ['OS lab', '38m']);
  assert.equal(R.month.hero, '2h 10m');
  assert.equal(R.month.columns.length, 30);
  assert.match(R.tooltip || '', /Fri 9.*40m/s, 'tooltip names the column and its total');

  assert.equal(R.live.hero, '50m', 'updates when new time is saved');

  assert.equal(R.trackingSetting, false, 'tracking checkbox saves the setting');
  assert.equal(R.idleSetting, 60, 'idle timeout select saves the setting');
  assert.deepEqual(R.pause && R.pause.until, null, 'pause button pauses until resumed');
  assert.match(R.pauseStatus, /paused/i);
  assert.equal(R.pauseAfterResume, null, 'second click resumes');
  assert.deepEqual(R.timeKeysAfterDelete, [], 'delete removes all time data');
  assert.equal(R.afterDelete.hero, '0s');
});
