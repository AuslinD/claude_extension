# How time tracking works

The extension measures how long you spend **prompting**, **waiting** for Claude, and **reading** on
claude.ai. Time when you aren't actually there is left out.

## What counts as what

Every second, the claude.ai tab you're looking at checks a few signals and picks **one** activity
(`classify` in [`src/activity.js`](../src/activity.js)):

| Activity | When | Counted? |
|---|---|---|
| **Prompting** | You typed in the message box in the last **15 s**. | yes |
| **Waiting** | Claude is generating a reply (the Stop button is showing). | yes |
| **Reading** | Nothing above, and you moved the mouse, scrolled, clicked or pressed a key recently. | yes |
| **Idle** | The tab is in front of you but there's been no input for the **idle timeout** (default 90 s). | recorded, **not** counted |
| *(nothing)* | Tab in the background, browser window not focused, tracking paused, or turned off. | not recorded |

The checks go top to bottom, so:
- Typing your **next** prompt while Claude is still answering counts as prompting.
- The keystrokes that **sent** a prompt don't keep you in "prompting" once Claude starts
  answering. Typing that happened before the reply started is ignored while it's streaming.
- While Claude is generating, the idle timeout is at least **3 minutes**. Watching an answer
  stream in needs no mouse or keyboard input.

### "Am I actually looking at it?"

A browser extension can't see your eyes, so it uses three layers:
1. **Tab visible and window focused.** Switch to another tab, app or window and counting stops
   immediately.
2. **Idle timeout.** If the tab is in front but there's no mouse, scroll-wheel, touch or keyboard
   input for the timeout, the time becomes *idle*. Plain `scroll` events don't count, because
   claude.ai scrolls the page by itself while a reply streams. That covers "left the tab open and walked away". You can set
   the timeout on the breakdown page (30 s – 10 min).
3. **Manual controls**, for when the first two get it wrong:
   - **Pause** in the toolbar popup: until you resume, for 15 minutes, or for 1 hour.
   - **Alt+Shift+P** toggles pause from anywhere in Chrome. You can change the shortcut at
     `chrome://extensions/shortcuts`.
   - **Discard last 10 min** in the popup removes time that already got counted.
   - While paused, a small ⏸ appears after the chat name on the label above the message box.

Known limit: the stretch *before* you go idle, up to the timeout, still counts as reading, since
there's no way to tell whether you were reading or already gone. A shorter timeout makes this
smaller.

## From seconds to segments

`step(tracker, observation)` runs once per second. Consecutive seconds with the same activity
in the same chat are merged into one **segment**:

```js
{ id: '<tab>:<start>', chatId: '…' | null, kind: 'reading', start: 1760036400000, end: 1760036460000 }
```

- A new segment starts when the activity or chat changes, or at local midnight, so a segment
  never spans two days.
- If more than 5 s pass between ticks (the computer slept, or Chrome throttled the tab), that gap
  is never counted.
- `chatId` is `null` on pages that aren't a chat, like the home page or a new chat before it's
  sent. Those show up as "Other pages" in the breakdown.

## Storage

`chrome.storage.local`, on this device only. Nothing is synced or sent anywhere, and no message
text is stored.

| Key | Value |
|---|---|
| `time:YYYY-MM-DD` | segments that started that local day |
| `pause` | `{ since, until }`. `until: null` means paused until you resume. |
| `discard` | `{ from, to }` of the last "discard" (a signal to open tabs, see below) |

The open segment is saved every 10 s, whenever it closes, and when the page is hidden or closed.
Saving is an upsert by `id`, so re-saving a growing segment just replaces it. Days older than
**60 days** are deleted when claude.ai loads.

**Discard and open tabs:** a tab that is counting right now holds a segment it hasn't saved yet.
If the popup only edited storage, that tab would save the discarded time again on its next flush.
`Store.discardTime` therefore also writes the `discard` key. Every claude.ai tab reacts by cutting
its in-memory segment the same way (`discardFromTracker`).

## Settings (`chrome.storage.sync` → `settings`)

| Setting | Default | |
|---|---|---|
| `tracking` | `true` | turn time tracking off completely |
| `idleSeconds` | `90` | idle timeout |

## Code map

| File | Role |
|---|---|
| `src/activity.js` | Pure logic: `classify`, `step`, `summarize`, `trimSegments`, `mergeSegments`, `discardFromTracker`, day/range helpers, `formatDuration`. |
| `src/storage.js` | `saveSegments`, `loadSegments`, `discardTime`, `pruneTime`, `clearTime`, `setPause`, `togglePause`. |
| `src/content.js` | Collects signals (input listeners, `isViewing`, `S.isStreaming`), runs `step` every tick, saves segments, shows ⏸. |
| `popup/` | Today's total, current activity, pause menu, discard, link to the breakdown. |
| `stats/` | Breakdown page: split bar, per-day chart, tables, settings. |
| `src/background.js` | Alt+Shift+P shortcut. |

Tests are described in [TESTING.md](TESTING.md#time-tracking).
