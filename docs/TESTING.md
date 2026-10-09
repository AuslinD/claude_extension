# Tests

```sh
npm test                            # every test/*.test.js, Node's built-in runner (Node 21+)
node --test test/activity.test.js   # one file
DEBUG_FIXTURE=1 npm test            # also print the headless-Chrome snapshots (handy when one fails)
```

No dependencies. CI (`.github/workflows/ci.yml`) runs the same command on every push.

## How the code is split so it can be tested

Everything that makes a decision lives in a **pure module** that runs in Node without a browser:
it takes plain values in and returns plain values out (no `chrome.*`, no DOM, no clock — the
current time is always passed in as `now`). Each module ends with

```js
root.CCC.<name> = api;                                         // in the extension
if (typeof module !== 'undefined' && module.exports) module.exports = api;  // in Node tests
```

so the same file is loaded by the extension and `require`d by the tests.

The glue that touches the page (`src/content.js`, `popup/`, `stats/`) is tested end to end in
**headless Chrome** against fake pages (`test/fixture.html`, `test/stats-fixture.html`).

## Workflow (TDD)

1. Write the test for the new behavior in the matching `test/*.test.js` file and watch it fail.
2. Implement the smallest change in the pure module that makes it pass.
3. Wire it into the page code, then add a step to the headless fixture scenario if the
   behavior depends on the DOM or timing.
4. Update this file and the feature doc.

## Test files

### `test/colors.test.js` — `src/colors.js`
Checks the palette with real color math (CIE ΔE), not snapshots:
57 unique named swatches; automatic colors differ from each other by ΔE ≥ 25 and from the next
one in the rotation by ΔE ≥ 35; older project chats get visibly fainter on light and dark
backgrounds; override priority (your pick > project color > automatic); text on the label stays
readable (contrast).

### `test/status.test.js` — `src/status.js`
The running → done state machine, driven with fake timestamps:
heartbeat throttling, "finished while you were away" (green ✓ Done) vs "finished while watching"
(nothing shown), other tabs not stealing ownership, API polling cadence, stop-reason / stable-
content detection, the 3-minute uncertain fallback, and pruning old entries.

### `test/helpers.test.js` — `src/selectors.js`, `src/storage.js`, `src/api.js`
Chat / project ids from URLs, title cleanup, turning `chrome.storage` items into in-memory state,
map merging, automatic color merging between tabs, recent colors, and parsing claude.ai's API
responses (chat list, conversation summary, project ranking).

### `test/activity.test.js` — `src/activity.js` (time tracking)
<a id="time-tracking"></a>
All driven by fake timestamps at a fixed local time, so day boundaries don't depend on the
machine's time zone.
- **classify**: not viewing / paused → nothing; typed recently → prompting; Claude generating →
  waiting, but the keystrokes that *sent* the prompt don't count once it starts; typing the next
  prompt during a reply → prompting; idle after the timeout; longer timeout while generating;
  user-set timeout wins when it's longer.
- **step**: seconds merge into one segment; activity or chat change splits it, and the new one
  starts where the old ended; time away or paused isn't counted; gaps over 5 s between ticks are
  never credited; idle becomes its own segment; segments never cross midnight.
- **summarize / buckets / splitRows**: totals by activity, chat and day, with idle left out;
  clipping to a range; hour columns for one day and day columns for longer ranges, with segments
  split at column edges; shares add up to exactly 100%.
- **trimSegments / discardFromTracker / mergeSegments**: cutting a window out (shorten or split),
  cutting the in-memory open segment so it isn't re-saved, upsert by id.
- Day keys, ranges, retention, pause expiry, duration formatting.

### `test/helpers.test.js`: time tracking storage
Uses `test/fake-chrome.js` (an in-memory `chrome.storage`) to run the real async helpers:
per-day upserts, loading only the days in a range, discard (including the signal to open tabs),
pruning past 60 days, delete-all, pause/toggle.

### `test/background.test.js` — `src/background.js`
Loads the service worker in Node against `fake-chrome.js` (`importScripts` is mapped to
`require`): badge counts, the Alt+Shift+P command toggling pause, and the toolbar tooltip
mentioning an active pause.

### `test/manifest.test.js`
Every file the manifest, popup and breakdown page load actually exists. Script order is right
(`activity.js` before `storage.js`). The release zip in `tools/package.sh` includes every folder.

### `test/stats.test.js` + `test/stats-fixture.html` + `test/stats-run.js` — `stats/`
The breakdown page on seeded data with a pinned clock (`CCC_TEST.now` = Fri 9 Oct 2026, 3 pm), so
results don't depend on when the test runs. Checks the headline total and idle note, the split
legend, hour/day columns and their stacking order, the tooltip, both tables, live updates when a
tab saves new time, and every control (tracking toggle, idle timeout, pause/resume, delete all).

### `test/dom.test.js` + `test/fixture.html` + `test/fixture-run.js` — `src/content.js`
`fixture.html` is a fake claude.ai page (sidebar links, a message box, a chat-message link) that
loads the real content scripts on top of `test/chrome-shim.js`, an in-memory `chrome.storage`.
`fixture-run.js` plays a scripted scenario (start a response, switch away, come back, navigate,
recolor, toggle settings, …) and writes JSON snapshots into `<pre id="results">`.

The last step of the scenario covers **time tracking** end to end. It types in the message box,
lets a fake response stream, scrolls, goes idle, switches windows, pauses and resumes, and
discards time. Each phase is checked as the *change* in stored totals, e.g. "typing added
1.5–3.5 s of prompting and nothing else". It also checks that the ⏸ marker shows while paused
and that a discard isn't undone by the tab's unsaved segment.

`dom.test.js` launches headless Chrome through `test/headless.js` with `--virtual-time-budget`,
so the ~45 s scenario runs in a few seconds. It reads the snapshots out of the dumped DOM and
asserts on them. It is **skipped** if Chrome isn't installed (set `CHROME_PATH` to point at it).

Timeouts are shortened for the fixture (`CCC.status.config` and `CCC.activity.config` are
overwritten in `fixture.html`), so the scenario doesn't have to wait minutes of virtual time.
Ticks are 1 s apart, so timing assertions use ranges rather than exact values.

Tip: open `test/fixture.html` directly in Chrome to watch the scenario run and read the results box.

## Test helpers

| File | What it is |
|---|---|
| `test/headless.js` | Launches headless Chrome on a test page and returns the JSON from `<pre id="results">` |
| `test/chrome-shim.js` | In-browser fake `chrome.storage` (with change events) for the fixture pages, seeded from `CCC_TEST.seed` |
| `test/fake-chrome.js` | Node fake of `chrome.storage`, `chrome.action`, `chrome.commands`, `chrome.runtime` events |

## Adding a test page

1. Copy `test/stats-fixture.html`: seed data in `CCC_TEST.seed`, load `chrome-shim.js`, the modules,
   the page script, and a runner script.
2. The runner drives the page, collects snapshots into an object, and appends
   `<pre id="results">JSON</pre>`. Don't add attributes to that tag; the reader matches it exactly.
3. In a `*.test.js`: `const R = await runPage('my-fixture.html', budgetMs)`, then assert.
4. The page re-renders on changes, so query elements again after each action. Chrome doesn't fire
   `change` on a detached checkbox.
