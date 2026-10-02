const test = require('node:test');
const assert = require('node:assert/strict');
const St = require('../src/status.js');
const { config } = St;

const ME = 'tab-a', OTHER = 'tab-b';
const obs = (prev, streaming, now, viewing = true, owner = ME) => St.observeLocal(prev, { streaming, now, viewing, owner });
const summary = (o) => ({ updatedAt: 'u', messageCount: 2, lastSender: 'assistant', lastUpdatedAt: null, lastLen: 10, stopReason: null, ...o });

test('idle chat with nothing happening stays null', () => {
  assert.equal(obs(undefined, false, 1000), null);
});

test('streaming starts running, heartbeat throttled, startedAt preserved', () => {
  const a = obs(null, true, 1000);
  assert.equal(St.markerFor(a), 'running');
  assert.equal(a.startedAt, 1000);
  assert.equal(obs(a, true, 1500), a, 'no rewrite inside heartbeat window');
  const b = obs(a, true, 1000 + config.HEARTBEAT_MS);
  assert.notEqual(b, a);
  assert.equal(b.heartbeat, 1000 + config.HEARTBEAT_MS);
  assert.equal(b.startedAt, 1000);
});

test('stream ends while viewing -> done but nothing shown', () => {
  const done = obs(obs(null, true, 0), false, 5000, true);
  assert.equal(done.state, 'done');
  assert.equal(St.markerFor(done), null);
});

test('stream ends while tab not focused -> green dot until viewed', () => {
  const done = obs(obs(null, true, 0), false, 5000, false);
  assert.equal(St.markerFor(done), 'done');
  const seen = obs(done, false, 6000, true);
  assert.equal(St.markerFor(seen), null);
});

test('a different tab does not mark another tab’s running chat as done', () => {
  const running = obs(null, true, 0, true, OTHER);
  assert.equal(obs(running, false, 1000, true, ME), running);
});

test('poll only after heartbeat is stale, then at POLL_MS intervals', () => {
  const r = obs(null, true, 0);
  assert.equal(St.needsPoll(r, config.STALE_MS - 1), false);
  assert.equal(St.needsPoll(r, config.STALE_MS), true);
  const polled = St.applyPoll(r, null, config.STALE_MS);
  assert.equal(St.needsPoll(polled, config.STALE_MS + 1), false);
  assert.equal(St.needsPoll(polled, config.STALE_MS + config.POLL_MS), true);
});

test('poll: stop_reason on fresh assistant message -> done (unseen)', () => {
  const r = obs(null, true, 0);
  const d = St.applyPoll(r, summary({ stopReason: 'end_turn' }), 7000);
  assert.equal(St.markerFor(d), 'done');
});

test('poll: running until conversation is stable for STABLE_MS', () => {
  let e = obs(null, true, 0);
  let t = config.STALE_MS;
  e = St.applyPoll(e, summary({ lastLen: 10 }), t);
  assert.equal(e.state, 'running');
  t += config.POLL_MS;
  e = St.applyPoll(e, summary({ lastLen: 50 }), t); // still growing
  assert.equal(e.state, 'running');
  assert.equal(e.stableSince, t);
  e = St.applyPoll(e, summary({ lastLen: 50 }), t + config.STABLE_MS - 1);
  assert.equal(e.state, 'running');
  e = St.applyPoll(e, summary({ lastLen: 50 }), t + config.STABLE_MS);
  assert.equal(St.markerFor(e), 'done');
});

test('poll: last message from the human keeps it running', () => {
  let e = obs(null, true, 0);
  e = St.applyPoll(e, summary({ lastSender: 'human' }), 7000);
  e = St.applyPoll(e, summary({ lastSender: 'human' }), 7000 + config.STABLE_MS * 2);
  assert.equal(e.state, 'running');
});

test('poll: an old assistant reply (previous turn) is not mistaken for the new one', () => {
  const start = Date.parse('2026-10-02T12:00:00Z');
  const e = obs(null, true, start);
  const old = summary({ stopReason: 'end_turn', lastUpdatedAt: '2026-10-02T11:50:00Z' });
  assert.equal(St.applyPoll(e, old, start + 7000).state, 'running');
});

test('expire: no evidence for FALLBACK_MS -> uncertain marker', () => {
  const e = obs(null, true, 0);
  assert.equal(St.expire(e, config.FALLBACK_MS - 1), e);
  const x = St.expire(e, config.FALLBACK_MS);
  assert.equal(St.markerFor(x), 'uncertain');
});

test('expire: never expires while heartbeat is fresh', () => {
  const e = obs(null, true, 0);
  e.heartbeat = config.FALLBACK_MS * 2;
  assert.equal(St.expire(e, config.FALLBACK_MS * 2 + 10), e);
});

test('expire: seen entries are pruned after a day', () => {
  const d = { state: 'done', finishedAt: 0, unseen: false };
  assert.equal(St.expire(d, config.PRUNE_MS - 1), d);
  assert.equal(St.expire(d, config.PRUNE_MS), null);
  const unseen = { ...d, unseen: true };
  assert.equal(St.expire(unseen, config.PRUNE_MS * 5), unseen, 'unseen dots stay until viewed');
});
