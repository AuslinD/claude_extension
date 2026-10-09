// Toolbar badge: green number = chats that finished and you haven't opened yet,
// gray number = chats still generating. Also handles the time-tracking pause shortcut.
'use strict';

importScripts('activity.js', 'storage.js');
const { activity: Act, storage: Store } = globalThis.CCC;

async function updateBadge() {
  const all = await chrome.storage.local.get(null);
  let done = 0, running = 0;
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith('status:') || !entry) continue;
    if (entry.state === 'running') running++;
    else if (entry.state === 'done' && entry.unseen) done++;
  }
  const parts = [];
  if (done) parts.push(`${done} finished (not opened yet)`);
  if (running) parts.push(`${running} still running`);
  if (Act.isPaused(all.pause, Date.now())) parts.push('time tracking paused');
  await chrome.action.setBadgeText({ text: done ? String(done) : running ? String(running) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: done ? '#16a34a' : '#64748b' });
  await chrome.action.setTitle({ title: 'Claude Chat Colors' + (parts.length ? ' — ' + parts.join(', ') : '') });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('status:') || k === 'pause')) return updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);

// Alt+Shift+P (changeable at chrome://extensions/shortcuts)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-tracking-pause') return Store.togglePause(Date.now());
});
