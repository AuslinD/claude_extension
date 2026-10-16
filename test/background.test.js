// src/background.js (service worker) with a fake chrome.*: badge counts and the pause shortcut.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { installFakeChrome } = require('./fake-chrome.js');

// The worker pulls in shared modules with importScripts(); in Node that's require().
globalThis.importScripts = (...files) => files.forEach((f) => require(path.join(__dirname, '../src', f)));

function loadWorker(seed) {
  const chrome = installFakeChrome(seed);
  delete require.cache[require.resolve('../src/background.js')];
  require('../src/background.js');
  return chrome;
}

test('background: badge counts finished-unseen chats first, then running ones', async () => {
  const chrome = loadWorker({ local: { 'status:a': { state: 'done', unseen: true }, 'status:b': { state: 'running' } } });
  await chrome.runtime.onStartup._fire();
  assert.equal(chrome.action._badge.text, '1');
  assert.match(chrome.action._badge.title, /1 finished.*1 still running/);
});

test('background: unread subagent summaries count toward the green badge', async () => {
  const chrome = loadWorker({ local: { 'status:a': { state: 'done', unseen: true }, inbox: { t1: { unread: true }, t2: { unread: false } } } });
  await chrome.runtime.onStartup._fire();
  assert.equal(chrome.action._badge.text, '2');
  assert.match(chrome.action._badge.title, /1 new in subagent inbox/);
});

test('background: Alt+Shift+P command toggles the time-tracking pause', async () => {
  const chrome = loadWorker();
  await chrome.commands.onCommand._fire('toggle-tracking-pause');
  assert.deepEqual(chrome.storage.local._data.pause && chrome.storage.local._data.pause.until, null, 'paused until resumed');
  await chrome.commands.onCommand._fire('toggle-tracking-pause');
  assert.equal('pause' in chrome.storage.local._data, false, 'resumed');
  await chrome.commands.onCommand._fire('something-else');
  assert.equal('pause' in chrome.storage.local._data, false);
});

test('background: toolbar tooltip mentions a pause so it is not forgotten', async () => {
  const chrome = loadWorker();
  await chrome.storage.local.set({ pause: { since: Date.now(), until: null } });
  assert.match(chrome.action._badge.title, /time tracking paused/i);
  await chrome.storage.local.remove('pause');
  assert.doesNotMatch(chrome.action._badge.title, /paused/i);
});

test('manifest: shortcut is declared', () => {
  const m = require('../manifest.json');
  assert.equal(m.commands['toggle-tracking-pause'].suggested_key.default, 'Alt+Shift+P');
});
