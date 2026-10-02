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
