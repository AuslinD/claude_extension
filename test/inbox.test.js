const test = require('node:test');
const assert = require('node:assert/strict');
const Inbox = require('../src/inbox.js');
const Api = require('../src/api.js');

const ctx = { chatId: 'c1', projectId: 'p1', now: 1000 };
const run = (id, o = {}) => ({ id, name: 'agent', task: 'Look into ' + id, summary: 'Result of ' + id, done: true, isError: false, finishedAt: null, ...o });

test('api: subagent tool calls are paired with their results', () => {
  const message = {
    sender: 'assistant',
    content: [
      { type: 'text', text: 'Splitting this up.' },
      { type: 'tool_use', id: 't1', name: 'launch_agent', input: { description: 'Find flights' } },
      { type: 'tool_use', id: 't2', name: 'Task', input: { prompt: 'Read the PDF' } },
      { type: 'tool_use', id: 't3', name: 'web_search', input: { query: 'x' } },
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Cheapest is $120.' }], stop_timestamp: '2026-10-16T12:00:00Z' },
      { type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: 'search hits' }] },
    ],
  };
  const s = Api.extractSubagents(message);
  assert.deepEqual(s.map((x) => x.id), ['t1', 't2'], 'ordinary tools are ignored');
  assert.equal(s[0].task, 'Find flights');
  assert.equal(s[0].summary, 'Cheapest is $120.');
  assert.equal(s[0].done, true);
  assert.equal(s[0].finishedAt, Date.parse('2026-10-16T12:00:00Z'));
  assert.equal(s[1].task, 'Read the PDF');
  assert.equal(s[1].done, false, 'no result yet = still running');
  assert.deepEqual(Api.extractSubagents(null), []);
});

test('api: conversation summary only reports subagents from the latest reply', () => {
  const s = Api.summarizeConversation({
    chat_messages: [
      { uuid: 'm1', index: 0, sender: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'agent', input: {} }] },
      { uuid: 'm2', index: 1, sender: 'human', text: 'again' },
      { uuid: 'm3', index: 2, sender: 'assistant', content: [{ type: 'tool_use', id: 'new', name: 'agent', input: {} }] },
    ],
  });
  assert.deepEqual(s.subagents.map((x) => x.id), ['new']);
});

test('api: project names come from the conversation list', () => {
  const r = Api.parseConversationList([{ uuid: 'c1', project_uuid: 'p1', project: { uuid: 'p1', name: 'Thesis' } }]);
  assert.deepEqual(r.projectNames, { p1: 'Thesis' });
});

test('inbox: finished subagents are added once, unfinished ones wait', () => {
  const a = Inbox.add({}, [run('t1'), run('t2', { done: false })], ctx);
  assert.deepEqual(Object.keys(a), ['t1']);
  assert.deepEqual(a.t1, { chatId: 'c1', projectId: 'p1', name: 'agent', task: 'Look into t1', summary: 'Result of t1', isError: false, finishedAt: 1000, unread: true });
  assert.equal(Inbox.add(a, [run('t1')], ctx), null, 'already there: no change');
  const read = Inbox.markRead(a);
  assert.equal(Inbox.add(read, [run('t1')], ctx), null, 'a read entry never turns unread again');
  assert.equal(Inbox.add(undefined, [], ctx), null);
});

test('inbox: long text is clipped, size is capped to the newest entries', () => {
  const e = Inbox.add({}, [run('t', { summary: 'word '.repeat(500) })], ctx).t;
  assert.ok(e.summary.length <= 400 && e.summary.endsWith('…'));
  let inbox = {};
  for (let i = 0; i < Inbox.MAX_ENTRIES + 5; i++) inbox = Inbox.add(inbox, [run('t' + i, { finishedAt: i + 1 })], ctx);
  assert.equal(Object.keys(inbox).length, Inbox.MAX_ENTRIES);
  assert.ok(!('t0' in inbox) && 't104' in inbox, 'oldest dropped');
});

test('inbox: mark read, unread count, arrivals', () => {
  const inbox = Inbox.add({}, [run('t1'), run('t2')], ctx);
  assert.equal(Inbox.unreadCount(inbox), 2);
  const one = Inbox.markRead(inbox, (_e, id) => id === 't1');
  assert.equal(Inbox.unreadCount(one), 1);
  assert.equal(Inbox.markRead(Inbox.markRead(inbox)), null, 'nothing left to mark');
  assert.deepEqual(Inbox.arrivals({ t1: inbox.t1 }, inbox), ['t2']);
  assert.deepEqual(Inbox.arrivals(inbox, one), [], 'marking read is not an arrival');
});

test('inbox: grouped by project, newest activity first, loose chats last', () => {
  let inbox = Inbox.add({}, [run('a', { finishedAt: 10 })], { chatId: 'c1', projectId: null, now: 0 });
  inbox = Inbox.add(inbox, [run('b', { finishedAt: 20 }), run('c', { finishedAt: 40 })], { chatId: 'c2', projectId: 'p1', now: 0 });
  inbox = Inbox.add(inbox, [run('d', { finishedAt: 30 })], { chatId: 'c3', projectId: 'p2abcdef99', now: 0 });
  const g = Inbox.groupByProject(Inbox.markRead(inbox, (_e, id) => id === 'b'), { p1: 'Thesis' });
  assert.deepEqual(g.map((x) => x.name), ['Thesis', 'Project p2abcdef', 'Chats outside a project']);
  assert.deepEqual(g[0].entries.map((e) => e.id), ['c', 'b']);
  assert.equal(g[0].unread, 1);
});
