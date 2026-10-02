// Toolbar badge: green number = chats that finished and you haven't opened yet,
// gray number = chats still generating.
'use strict';

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
  await chrome.action.setBadgeText({ text: done ? String(done) : running ? String(running) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: done ? '#16a34a' : '#64748b' });
  await chrome.action.setTitle({ title: 'Claude Chat Colors' + (parts.length ? ' — ' + parts.join(', ') : '') });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('status:'))) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
