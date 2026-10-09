# Plan: time tracking (v1.2.0)

Goal: track how long you spend **prompting**, **waiting** for Claude, and **reading** in claude.ai,
show the split on demand (never always visible), and leave out time when you aren't actually there.

The existing features (chat colors, picker, running/done markers, popup) stay the same.

## Decisions

| Question | Decision | Why |
|---|---|---|
| What counts as each activity? | **Prompting** = typed in the message box in the last 15 s. **Waiting** = Claude is generating and you're on the tab. **Reading** = on the tab, not typing, Claude not generating, and you moved the mouse / scrolled / pressed a key recently. | Matches the three phases of a chat turn. Typing during a response still counts as prompting (you're writing the next one). |
| How do we know you're "actually looking"? | Count time only when the tab is visible **and** the window has focus, **and** you interacted with the page recently (default 90 s; 3 min while Claude is generating, since watching output needs no input). Otherwise the time is **idle** and excluded. | No camera / OS-level access needed. Idle time is still shown (greyed out) so you can see what was dropped. |
| Manual off switch | **Pause** in the popup (until resumed, or for 15 min / 1 h), a keyboard shortcut (**Alt+Shift+P**), and **Discard last 10 min** for "oops, I walked away". A small ⏸ appears on the chat label while paused. | Non-intrusive: no new buttons on claude.ai itself. |
| Where is the breakdown? | Popup shows a single line ("Today: 1h 12m") with **View breakdown**, which opens a full page with a split bar, a per-day chart, and tables (by activity and by chat). | "Click to see", not always visible. Room for a real chart. |
| Storage | `chrome.storage.local["time:YYYY-MM-DD"]` = list of segments `{id, chatId, kind, start, end}`; consecutive seconds of the same activity are merged into one segment. Kept 60 days. | A timeline (not just totals) makes "discard last N min" exact and enables the per-day chart. Per-day keys keep each write small. |
| Privacy | Same as before: nothing leaves the browser. No message text is stored, only timestamps, chat ids and activity kind. | |

## Steps (TDD: each step starts with failing tests)

1. [x] Plan + docs skeleton (`docs/PLAN.md`, `docs/TESTING.md`, `docs/TIME_TRACKING.md`).
2. [x] `src/activity.js` (pure): `classify`, `step` (segment coalescing, gaps, day boundaries),
   `summarize`, `trimSegments`, `mergeSegments`, pause helpers, day keys, `formatDuration`.
   Tests: `test/activity.test.js`.
3. [x] `src/storage.js`: tracking settings defaults, `pause` key, `time:` helpers (save / trim / prune / clear).
   Tests: `test/helpers.test.js`.
4. [x] `src/content.js`: collect input signals, run the tracker every tick, flush segments,
   ⏸ marker on the label. Tests: new step in `test/fixture-run.js` (headless Chrome).
5. [x] Popup: "Time" section (today's total, Pause menu, Discard last 10 min, View breakdown).
6. [x] Breakdown page `stats/stats.html`: range picker, split bar, per-day chart, tables, settings.
   Tests: `test/stats-fixture.html` + `test/stats.test.js` (headless Chrome).
7. [x] Keyboard shortcut (`commands` in the manifest, handled in `src/background.js`).
8. [x] README, version bump to 1.2.0.

Also added along the way: `test/background.test.js` (the service worker had no tests),
`test/manifest.test.js` (caught `stats/` missing from the release zip), largest-remainder
percentages so the split always adds up to 100%.

## Known limits / ideas for later

- "Reading" can't tell reading apart from staring at the page; the idle timeout is the only guard.
  The timeout is adjustable on the breakdown page.
- The last stretch before going idle (up to the timeout) is still counted as reading.
- Possible next steps: `chrome.idle` for screen-lock detection, per-project totals, CSV export.
