const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/activity.js');
const { config } = A;

const T0 = new Date(2026, 9, 9, 14, 0, 0).getTime(); // local 2:00 pm, so day keys don't depend on the time zone
const S = 1000, MIN = 60 * S;
const base = (o) => ({ viewing: true, paused: false, streaming: false, now: T0, typedAt: null, inputAt: T0, streamStart: null, idleMs: config.IDLE_MS, ...o });

// ---------- classify ----------

test('classify: not looking at the tab or paused -> not counted', () => {
  assert.equal(A.classify(base({ viewing: false })), null);
  assert.equal(A.classify(base({ paused: true })), null);
  assert.equal(A.classify(base({ viewing: false, streaming: true })), null);
});

test('classify: typed recently -> prompting', () => {
  assert.equal(A.classify(base({ typedAt: T0 - 2 * S })), 'prompting');
  assert.equal(A.classify(base({ typedAt: T0 - config.TYPING_MS + 1 })), 'prompting');
  assert.equal(A.classify(base({ typedAt: T0 - config.TYPING_MS })), 'reading', 'typing grace ran out');
});

test('classify: Claude generating -> waiting; typing that sent the prompt does not count as prompting', () => {
  assert.equal(A.classify(base({ streaming: true, streamStart: T0 - 5 * S })), 'waiting');
  assert.equal(A.classify(base({ streaming: true, streamStart: T0 - 5 * S, typedAt: T0 - 6 * S })), 'waiting');
  assert.equal(A.classify(base({ streaming: true, streamStart: T0 - 5 * S, typedAt: T0 - 1 * S })), 'prompting',
    'typing the next prompt while Claude answers is prompting');
});

test('classify: nothing going on and recent input -> reading', () => {
  assert.equal(A.classify(base({ inputAt: T0 - 30 * S })), 'reading');
});

test('classify: no input for the idle timeout -> idle', () => {
  assert.equal(A.classify(base({ inputAt: T0 - config.IDLE_MS })), 'idle');
  assert.equal(A.classify(base({ inputAt: T0 - config.IDLE_MS + 1 })), 'reading');
  assert.equal(A.classify(base({ inputAt: null })), 'idle', 'never interacted');
  assert.equal(A.classify(base({ inputAt: T0 - 20 * S, idleMs: 10 * S })), 'idle', 'idle timeout is configurable');
});

test('classify: while Claude generates, the idle timeout is longer (watching needs no input)', () => {
  const s = { streaming: true, streamStart: T0 - 10 * MIN };
  assert.equal(A.classify(base({ ...s, inputAt: T0 - config.IDLE_MS - S })), 'waiting');
  assert.equal(A.classify(base({ ...s, inputAt: T0 - config.WAIT_IDLE_MS })), 'idle');
  assert.equal(A.classify(base({ ...s, inputAt: T0 - config.WAIT_IDLE_MS - S, idleMs: 10 * MIN })), 'waiting',
    'a user idle timeout longer than WAIT_IDLE_MS wins');
});

// ---------- step: turning ticks into segments ----------

function run(ticks, owner = 'tab') {
  let tr = A.newTracker();
  const closed = [];
  for (const t of ticks) {
    const r = A.step(tr, { owner, chatId: 'c1', viewing: true, paused: false, streaming: false, typedAt: null, inputAt: t.now, idleMs: config.IDLE_MS, ...t });
    tr = r.tracker;
    closed.push(...r.closed);
  }
  return { tracker: tr, closed, all: closed.concat(tr.open && tr.open.end > tr.open.start ? [tr.open] : []) };
}
const secs = (from, to, o = {}) => Array.from({ length: to - from + 1 }, (_, i) => ({ now: T0 + (from + i) * S, ...o }));

test('step: consecutive seconds of one activity become one segment', () => {
  const { closed, tracker } = run(secs(0, 10));
  assert.equal(closed.length, 0);
  assert.deepEqual(
    { kind: tracker.open.kind, chatId: tracker.open.chatId, start: tracker.open.start, end: tracker.open.end },
    { kind: 'reading', chatId: 'c1', start: T0, end: T0 + 10 * S });
  assert.equal(tracker.open.id, 'tab:' + T0);
});

test('step: switching activity closes the segment; the new one starts where the old ended', () => {
  const { all } = run([...secs(0, 5), ...secs(6, 9, { typedAt: T0 + 6 * S })]);
  assert.deepEqual(all.map((s) => [s.kind, (s.start - T0) / S, (s.end - T0) / S]), [['reading', 0, 5], ['prompting', 5, 9]]);
});

test('step: switching chats starts a new segment', () => {
  const { all } = run([...secs(0, 3), ...secs(4, 6, { chatId: 'c2' })]);
  assert.deepEqual(all.map((s) => [s.chatId, (s.start - T0) / S, (s.end - T0) / S]), [['c1', 0, 3], ['c2', 3, 6]]);
});

test('step: rising edge of streaming is remembered so the sending keystrokes are not prompting', () => {
  const typed = T0 + 2 * S;
  const { all } = run([...secs(0, 2, { typedAt: typed }), ...secs(3, 8, { typedAt: typed, streaming: true })]);
  assert.deepEqual(all.map((s) => s.kind), ['prompting', 'waiting']);
});

test('step: time away (not viewing) is not counted and splits segments', () => {
  const { all } = run([...secs(0, 3), ...secs(4, 20, { viewing: false }), ...secs(21, 25)]);
  assert.deepEqual(all.map((s) => [(s.start - T0) / S, (s.end - T0) / S]), [[0, 3], [21, 25]]);
});

test('step: a gap between ticks (sleep, throttled tab) is never credited', () => {
  const { all } = run([...secs(0, 3), ...secs(3 + config.TICK_MAX_MS / S + 1, 30)]);
  assert.equal(all.length, 2);
  assert.equal(A.summarize(all).total, 3 * S + (30 - (3 + config.TICK_MAX_MS / S + 1)) * S);
});

test('step: paused time is not counted', () => {
  const { all } = run([...secs(0, 3), ...secs(4, 10, { paused: true }), ...secs(11, 12)]);
  assert.equal(A.summarize(all).total, 4 * S);
});

test('step: idle is recorded as its own (excluded) kind', () => {
  const ticks = secs(0, 200).map((t) => ({ ...t, inputAt: T0 }));
  const { all } = run(ticks);
  assert.deepEqual(all.map((s) => s.kind), ['reading', 'idle']);
  const sum = A.summarize(all);
  assert.equal(sum.kinds.reading, config.IDLE_MS - S);
  assert.equal(sum.total, sum.kinds.reading, 'idle is excluded from the total');
  assert.ok(sum.kinds.idle > 0);
});

test('step: segments never cross midnight', () => {
  const late = new Date(2026, 9, 9, 23, 59, 58).getTime();
  const { all } = run(Array.from({ length: 5 }, (_, i) => ({ now: late + i * S })));
  assert.equal(all.length, 2);
  assert.equal(A.dayKey(all[0].start), '2026-10-09');
  assert.equal(A.dayKey(all[1].start), '2026-10-10');
  for (const s of all) assert.equal(A.dayKey(s.start), A.dayKey(s.end - 1));
});

// ---------- summarize / trim / merge ----------

const seg = (kind, from, to, chatId = 'c1', id) => ({ id: id || `x:${from}`, chatId, kind, start: T0 + from * S, end: T0 + to * S });

test('summarize: totals by activity, by chat and by day; idle excluded from totals', () => {
  const sum = A.summarize([seg('prompting', 0, 30), seg('waiting', 30, 90), seg('reading', 90, 150, 'c2'), seg('idle', 150, 400, 'c2')]);
  assert.deepEqual(sum.kinds, { prompting: 30 * S, waiting: 60 * S, reading: 60 * S, idle: 250 * S });
  assert.equal(sum.total, 150 * S);
  assert.equal(sum.byChat.c1.total, 90 * S);
  assert.equal(sum.byChat.c2.reading, 60 * S);
  assert.equal(sum.byChat.c2.total, 60 * S);
  assert.equal(sum.byDay['2026-10-09'].total, 150 * S);
});

test('summarize: clips to the requested range', () => {
  const sum = A.summarize([seg('reading', 0, 100)], { from: T0 + 40 * S, to: T0 + 60 * S });
  assert.equal(sum.total, 20 * S);
  assert.equal(A.summarize([seg('reading', 0, 10)], { from: T0 + 20 * S, to: T0 + 30 * S }).total, 0);
});

test('summarize: chat id null (new-chat page, home) is grouped under ""', () => {
  const sum = A.summarize([seg('prompting', 0, 10, null)]);
  assert.equal(sum.byChat[''].prompting, 10 * S);
});

test('trimSegments: removes a time window, shortening or splitting segments', () => {
  const list = [seg('reading', 0, 10), seg('waiting', 10, 50), seg('reading', 50, 60)];
  const out = A.trimSegments(list, T0 + 5 * S, T0 + 55 * S);
  assert.deepEqual(out.map((s) => [s.kind, (s.start - T0) / S, (s.end - T0) / S]), [['reading', 0, 5], ['reading', 55, 60]]);
  const split = A.trimSegments([seg('reading', 0, 60)], T0 + 20 * S, T0 + 30 * S);
  assert.deepEqual(split.map((s) => [(s.start - T0) / S, (s.end - T0) / S]), [[0, 20], [30, 60]]);
  assert.notEqual(split[0].id, split[1].id, 'split halves get distinct ids');
  assert.equal(A.trimSegments(list, T0 + 100 * S, T0 + 200 * S), list, 'nothing to trim -> same array');
});

test('mergeSegments: upsert by id, sorted by start, drops empty segments', () => {
  const a = seg('reading', 0, 5, 'c1', 'a');
  const b = seg('waiting', 5, 9, 'c1', 'b');
  const grown = { ...a, end: T0 + 7 * S };
  assert.deepEqual(A.mergeSegments([b, a], [grown]), [grown, b]);
  assert.equal(A.mergeSegments([], [seg('reading', 3, 3)]), null, 'empty segments are dropped');
  assert.equal(A.mergeSegments([a], [a]), null, 'no change -> null');
});

// ---------- days, ranges, pause, formatting ----------

test('dayKey / rangeFor / daysBetween use local days', () => {
  assert.equal(A.dayKey(T0), '2026-10-09');
  const today = A.rangeFor('today', T0);
  assert.equal(today.from, new Date(2026, 9, 9).getTime());
  assert.equal(today.to, T0);
  assert.equal(A.rangeFor('7d', T0).from, new Date(2026, 9, 3).getTime());
  assert.deepEqual(A.daysBetween(A.rangeFor('7d', T0).from, T0),
    ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.equal(A.daysBetween(A.rangeFor('30d', T0).from, T0).length, 30);
});

test('staleDayKeys: time:* keys older than the retention window', () => {
  const keys = ['time:2026-10-09', 'time:2026-08-11', 'time:2026-08-10', 'time:2025-01-01', 'status:x', 'titles'];
  assert.deepEqual(A.staleDayKeys(keys, T0, 60), ['time:2026-08-10', 'time:2025-01-01']);
});

test('isPaused: until resumed, or until a time', () => {
  assert.equal(A.isPaused(null, T0), false);
  assert.equal(A.isPaused({ since: T0 - S, until: null }, T0), true);
  assert.equal(A.isPaused({ since: T0 - S, until: T0 + S }, T0), true);
  assert.equal(A.isPaused({ since: T0 - S, until: T0 }, T0), false, 'timed pause ran out');
});

test('formatDuration: short, readable', () => {
  assert.equal(A.formatDuration(0), '0s');
  assert.equal(A.formatDuration(42 * S), '42s');
  assert.equal(A.formatDuration(59.9 * S), '59s');
  assert.equal(A.formatDuration(12 * MIN + 59 * S), '12m');
  assert.equal(A.formatDuration(65 * MIN), '1h 05m');
  assert.equal(A.formatDuration(26 * 60 * MIN), '26h 00m');
});

test('splitRows: one row per counted activity with share of the total', () => {
  const rows = A.splitRows({ prompting: 30 * S, waiting: 10 * S, reading: 60 * S, idle: 500 * S });
  assert.deepEqual(rows.map((r) => [r.kind, r.label, r.pct]), [['prompting', 'Prompting', 30], ['waiting', 'Waiting', 10], ['reading', 'Reading', 60]]);
  assert.deepEqual(A.splitRows({ prompting: 0, waiting: 0, reading: 0, idle: 0 }).map((r) => r.pct), [0, 0, 0]);
  const thirds = A.splitRows({ prompting: 1, waiting: 1, reading: 1 }).map((r) => r.pct);
  assert.equal(thirds.reduce((a, b) => a + b), 100, 'shares always add up to 100%');
  assert.deepEqual(A.splitRows({ prompting: 12, waiting: 5, reading: 23 }).map((r) => r.pct), [30, 13, 57]);
});

test('discardFromTracker: the in-memory open segment is cut too, so it is not re-saved', () => {
  const { tracker } = run(secs(0, 600));
  const r = A.discardFromTracker(tracker, T0 + 300 * S, T0 + 600 * S);
  assert.deepEqual(r.pieces.map((s) => [(s.start - T0) / S, (s.end - T0) / S]), [[0, 300]]);
  assert.equal(r.pieces[0].id, tracker.open.id, 'same id -> replaces the stored version');
  assert.equal(r.tracker.open, null);
  assert.equal(r.tracker.counting, false, 'next tick starts a fresh segment at its own time');
  const untouched = A.discardFromTracker(tracker, T0 - 100 * S, T0 - 50 * S);
  assert.equal(untouched.tracker, tracker);
  assert.deepEqual(untouched.pieces, []);
});

test('buckets: hours for one day, days for longer ranges; segments split across bucket edges', () => {
  const midnight = A.dayStart(T0);
  const segs = [
    { id: 'a', chatId: 'c', kind: 'reading', start: T0 - 10 * MIN, end: T0 + 10 * MIN }, // 1:50 -> 2:10 pm
    { id: 'b', chatId: 'c', kind: 'idle', start: T0, end: T0 + 5 * MIN },
  ];
  const hours = A.buckets(segs, { from: midnight, to: T0 + 30 * MIN });
  assert.equal(hours.unit, 'hour');
  assert.equal(hours.list.length, 15, 'midnight through the current hour');
  assert.equal(hours.list[13].kinds.reading, 10 * MIN);
  assert.equal(hours.list[14].kinds.reading, 10 * MIN);
  assert.equal(hours.list[14].total, 10 * MIN, 'idle not in total');
  assert.equal(hours.list[14].label, '2 pm');
  assert.equal(hours.list[0].label, '12 am');

  const days = A.buckets(segs, A.rangeFor('7d', T0));
  assert.equal(days.unit, 'day');
  assert.deepEqual(days.list.map((b) => b.key), A.daysBetween(A.rangeFor('7d', T0).from, T0));
  assert.equal(days.list[6].total, 20 * MIN);
  assert.equal(days.list[6].label, 'Fri 9');
  assert.equal(days.max, 20 * MIN);
});
