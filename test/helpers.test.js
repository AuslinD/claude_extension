const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/selectors.js');
const Store = require('../src/storage.js');
const Api = require('../src/api.js');

const CHAT = '0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const PROJ = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('chat / project ids from paths', () => {
  assert.equal(S.chatIdFromPath('/chat/' + CHAT), CHAT);
  assert.equal(S.chatIdFromPath('https://claude.ai/chat/' + CHAT.toUpperCase() + '?x=1'), CHAT);
  assert.equal(S.chatIdFromPath('/new'), null);
  assert.equal(S.chatIdFromPath('/chat/not-a-uuid'), null);
  assert.equal(S.projectIdFromPath('/project/' + PROJ), PROJ);
  assert.equal(S.projectIdFromPath('/projects'), null);
});

test('cleanTitle strips the Claude suffix', () => {
  assert.equal(S.cleanTitle('Linear algebra help - Claude'), 'Linear algebra help');
  assert.equal(S.cleanTitle('OS lab | Claude'), 'OS lab');
  assert.equal(S.cleanTitle('Claude'), '');
  assert.equal(S.cleanTitle(''), '');
});

test('storage: items -> state and change application', () => {
  const s = Store.fromItems(
    { ['color:' + CHAT]: '#112233', ['pcolor:' + PROJ]: '#445566', settings: { tint: true } },
    { ['status:' + CHAT]: { state: 'running' }, projectMap: { [CHAT]: PROJ }, titles: { [CHAT]: 'T' } }
  );
  assert.equal(s.colors[CHAT], '#112233');
  assert.equal(s.projectColors[PROJ], '#445566');
  assert.equal(s.settings.tint, true);
  assert.equal(s.settings.sidebar, true, 'defaults fill missing settings');
  assert.equal(s.statuses[CHAT].state, 'running');
  assert.equal(s.projectMap[CHAT], PROJ);

  Store.applyChanges(s, 'sync', { ['color:' + CHAT]: { oldValue: '#112233' } });
  assert.equal(CHAT in s.colors, false, 'removed key deletes override');
  Store.applyChanges(s, 'local', { ['status:' + CHAT]: { newValue: { state: 'done' } } });
  assert.equal(s.statuses[CHAT].state, 'done');
});

test('storage: mergeMap reports changes and deletes nulls', () => {
  assert.equal(Store.mergeMap({ a: 1 }, { a: 1 }), null);
  assert.deepEqual(Store.mergeMap({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  assert.deepEqual(Store.mergeMap({ a: 1, b: 2 }, { a: null }), { b: 2 });
  assert.equal(Store.mergeMap({}, { a: null }), null);
});

test('api: conversation list parsing (array or wrapped)', () => {
  const list = [
    { uuid: 'c1', name: 'One', project_uuid: 'p1' },
    { uuid: 'c2', name: 'Two', project_uuid: null },
    { nope: true },
  ];
  const r = Api.parseConversationList(list);
  assert.deepEqual(r.projectMap, { c1: 'p1', c2: null });
  assert.deepEqual(r.titles, { c1: 'One', c2: 'Two' });
  assert.deepEqual(Api.parseConversationList({ data: list }), r);
  assert.equal(Api.parseConversationList({ error: 'x' }), null);
  assert.equal(Api.parseConversationList(null), null);
});

test('api: conversation summary uses the current leaf message', () => {
  const json = {
    updated_at: '2026-10-02T00:00:00Z',
    current_leaf_message_uuid: 'm2',
    chat_messages: [
      { uuid: 'm1', index: 0, sender: 'human', text: 'hi' },
      { uuid: 'm2', index: 1, sender: 'assistant', content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', updated_at: 'x' },
      { uuid: 'm3', index: 1, sender: 'assistant', text: 'other branch' },
    ],
  };
  const s = Api.summarizeConversation(json);
  assert.equal(s.lastSender, 'assistant');
  assert.equal(s.stopReason, 'end_turn');
  assert.equal(s.messageCount, 3);
  assert.ok(s.lastLen > 0);
  assert.equal(Api.summarizeConversation(null), null);
  assert.equal(Api.summarizeConversation({}).lastSender, null);
});

test('api: project rank = position by creation time, newest first, per project', () => {
  const r = Api.parseConversationList([
    { uuid: 'old', project_uuid: 'p1', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' },
    { uuid: 'new', project_uuid: 'p1', created_at: '2026-09-20T00:00:00Z' },
    { uuid: 'mid', project_uuid: 'p1', created_at: '2026-09-10T00:00:00Z' },
    { uuid: 'other', project_uuid: 'p2', created_at: '2026-08-01T00:00:00Z' },
    { uuid: 'loose', project_uuid: null, created_at: '2026-09-30T00:00:00Z' },
  ]);
  assert.deepEqual(r.projectRank, { new: 0, mid: 1, old: 2, other: 0 });
  assert.equal('loose' in r.projectRank, false);
});

test('storage: automatic color assignments merge, existing ones win', () => {
  const stored = { chats: { a: 0 }, projects: {}, next: 1 };
  const mine = { chats: { a: 5, b: 1 }, projects: { p: 2 }, next: 3 };
  assert.deepEqual(Store.mergeAutoValues(stored, mine), { chats: { a: 0, b: 1 }, projects: { p: 2 }, next: 3 });
  assert.equal(Store.mergeAutoValues(stored, { chats: { a: 0 }, projects: {}, next: 1 }), null, 'no-op');
  assert.deepEqual(Store.mergeAutoValues(undefined, mine), mine);
});

test('storage: recent colors are newest first, unique, capped at 10', () => {
  let list = [];
  for (let i = 0; i < 12; i++) list = Store.withRecent(list, '#00000' + (i % 10));
  assert.equal(list.length, 10);
  assert.equal(list[0], '#000001');
  assert.equal(new Set(list).size, 10);
  assert.deepEqual(Store.withRecent(['#aaaaaa', '#bbbbbb'], '#BBBBBB'), ['#bbbbbb', '#aaaaaa']);
});

// ---------- time tracking storage ----------

const Act = require('../src/activity.js');
const { installFakeChrome } = require('./fake-chrome.js');
const DAY1 = new Date(2026, 9, 9, 14, 0, 0).getTime();
const DAY2 = new Date(2026, 9, 10, 9, 0, 0).getTime();
const tseg = (id, start, secs, kind = 'reading') => ({ id, chatId: CHAT, kind, start, end: start + secs * 1000 });

test('storage: tracking settings default on with a 90 s idle timeout', () => {
  const s = Store.fromItems({}, {});
  assert.equal(s.settings.tracking, true);
  assert.equal(s.settings.idleSeconds, 90);
  assert.equal(s.pause, null);
});

test('storage: pause state comes from local storage and follows changes', () => {
  const s = Store.fromItems({}, { pause: { since: 1, until: null } });
  assert.deepEqual(s.pause, { since: 1, until: null });
  Store.applyChanges(s, 'local', { pause: { oldValue: s.pause } });
  assert.equal(s.pause, null);
  Store.applyChanges(s, 'local', { ['time:2026-10-09']: { newValue: [] } });
  assert.equal('time:2026-10-09' in s, false, 'time data is not kept in page state');
});

test('storage: segmentsByDayKey groups by the local day a segment starts', () => {
  const g = Store.segmentsByDayKey([tseg('a', DAY1, 5), tseg('b', DAY2, 5), tseg('c', DAY1 + 9000, 5)]);
  assert.deepEqual(Object.keys(g).sort(), ['time:2026-10-09', 'time:2026-10-10']);
  assert.deepEqual(g['time:2026-10-09'].map((s) => s.id), ['a', 'c']);
});

test('storage: saveSegments upserts into per-day keys', async () => {
  const chrome = installFakeChrome();
  await Store.saveSegments([tseg('a', DAY1, 5)]);
  await Store.saveSegments([tseg('a', DAY1, 9), tseg('b', DAY2, 3)]);
  assert.deepEqual(chrome.storage.local._data['time:2026-10-09'], [tseg('a', DAY1, 9)]);
  assert.deepEqual(chrome.storage.local._data['time:2026-10-10'], [tseg('b', DAY2, 3)]);
});

test('storage: loadSegments reads only the days in the range', async () => {
  installFakeChrome({ local: {
    'time:2026-10-09': [tseg('a', DAY1, 5)],
    'time:2026-10-10': [tseg('b', DAY2, 5)],
  } });
  const segs = await Store.loadSegments(Act.dayStart(DAY2), DAY2 + 60000);
  assert.deepEqual(segs.map((s) => s.id), ['b']);
  assert.equal((await Store.loadSegments(0, DAY2 + 60000, { all: true })).length, 2, 'all: every stored day');
});

test('storage: discardTime cuts a window out of the stored timeline', async () => {
  const chrome = installFakeChrome({ local: { 'time:2026-10-09': [tseg('a', DAY1, 600)] } });
  await Store.discardTime(DAY1 + 300000, DAY1 + 600000);
  assert.deepEqual(chrome.storage.local._data['time:2026-10-09'], [tseg('a', DAY1, 300)]);
  assert.deepEqual(chrome.storage.local._data.discard, { from: DAY1 + 300000, to: DAY1 + 600000 },
    'open tabs are told, so they cut their unsaved segment too');
});

test('storage: pruneTime drops days past the retention window; clearTime removes all', async () => {
  const chrome = installFakeChrome({ local: { 'time:2026-10-09': [], 'time:2026-01-01': [], titles: {} } });
  await Store.pruneTime(DAY1);
  assert.deepEqual(Object.keys(chrome.storage.local._data).sort(), ['time:2026-10-09', 'titles']);
  await Store.clearTime();
  assert.deepEqual(Object.keys(chrome.storage.local._data), ['titles']);
});

test('storage: setPause / togglePause', async () => {
  const chrome = installFakeChrome();
  await Store.setPause({ since: DAY1, until: DAY1 + 900000 });
  assert.deepEqual(chrome.storage.local._data.pause, { since: DAY1, until: DAY1 + 900000 });
  await Store.togglePause(DAY1 + 1000);
  assert.equal('pause' in chrome.storage.local._data, false, 'active pause -> resumed');
  await Store.togglePause(DAY1 + 2000);
  assert.deepEqual(chrome.storage.local._data.pause, { since: DAY1 + 2000, until: null });
  await Store.setPause({ since: DAY1, until: DAY1 + 1 });
  await Store.togglePause(DAY1 + 5000);
  assert.deepEqual(chrome.storage.local._data.pause, { since: DAY1 + 5000, until: null }, 'expired pause -> pause again');
});
