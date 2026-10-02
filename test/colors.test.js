const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/colors.js');

// ΔE (CIE76) rules of thumb: ~2.3 just noticeable, >10 obvious side by side, >20 clearly different colors.
const LIGHT_BG = '#ffffff';
const DARK_BG = '#262624'; // claude.ai dark mode

test('palette: 19 named colors x light/normal/dark, no duplicates', () => {
  assert.equal(C.SWATCHES.length, 57);
  assert.equal(new Set(C.SWATCHES.map((s) => s.hex)).size, 57);
  assert.equal(new Set(C.SWATCHES.map((s) => s.name)).size, 57);
  for (const s of C.SWATCHES) assert.ok(C.isHex(s.hex), s.hex);
  assert.ok(C.SWATCHES.some((s) => s.name === 'Light blue'));
  assert.ok(C.SWATCHES.some((s) => s.name === 'Dark green'));
});

test('automatic colors are all clearly different from each other', () => {
  for (let i = 0; i < C.AUTO.length; i++) {
    for (let j = i + 1; j < C.AUTO.length; j++) {
      const d = C.deltaE(C.AUTO[i], C.AUTO[j]);
      assert.ok(d >= 25, `${C.nameFor(C.AUTO[i])} vs ${C.nameFor(C.AUTO[j])}: ΔE ${d.toFixed(1)}`);
    }
  }
});

test('automatic colors have plain names (no "custom")', () => {
  for (const c of C.AUTO) assert.doesNotMatch(C.nameFor(c), /Custom/, c);
});

test('rotation: chats seen one after another get very different colors', () => {
  for (let i = 0; i < C.AUTO.length; i++) {
    const d = C.deltaE(C.autoColor(i), C.autoColor(i + 1));
    assert.ok(d >= 35, `slot ${i} -> ${i + 1}: ΔE ${d.toFixed(1)}`);
  }
  assert.equal(C.autoColor(C.AUTO.length), C.autoColor(0), 'wraps around');
});

test('project fading: newest chat is the full color, each older one visibly lighter on light pages', () => {
  for (const base of C.AUTO) {
    let prev = null;
    for (let rank = 0; rank < C.FADE.length; rank++) {
      const c = C.resolveColor({ chatId: 'x', projectId: 'p', projectOverride: base, rank, background: LIGHT_BG }).color;
      if (rank === 0) assert.equal(c, base);
      if (prev) {
        const d = C.deltaE(prev, c);
        assert.ok(d >= 6, `${C.nameFor(base)} rank ${rank - 1}->${rank}: ΔE ${d.toFixed(1)}`);
      }
      prev = c;
    }
  }
});

test('project fading also reads in dark mode (fades toward the dark background)', () => {
  for (const base of C.AUTO) {
    let prev = null;
    for (let rank = 0; rank < C.FADE.length; rank++) {
      const c = C.resolveColor({ chatId: 'x', projectId: 'p', projectOverride: base, rank, background: DARK_BG }).color;
      if (prev) {
        const d = C.deltaE(prev, c);
        assert.ok(d >= 4.5, `${C.nameFor(base)} rank ${rank - 1}->${rank} on dark: ΔE ${d.toFixed(1)}`);
      }
      prev = c;
    }
    // even the faintest step is still visible against the page
    const faint = C.resolveColor({ chatId: 'x', projectId: 'p', projectOverride: base, rank: 99, background: DARK_BG }).color;
    assert.ok(C.deltaE(faint, DARK_BG) >= 8, `${C.nameFor(base)} faintest vs dark page`);
  }
});

test('ranks past the last fade step share the faintest color', () => {
  const at = (rank) => C.resolveColor({ chatId: 'x', projectId: 'p', projectOverride: '#3b82f6', rank }).color;
  assert.equal(at(C.FADE.length - 1), at(C.FADE.length + 5));
});

test('resolveColor priority: chat color > project color > automatic', () => {
  const chat = C.resolveColor({ chatId: 'c', projectId: 'p', override: '#ABCDEF', rank: 3 });
  assert.equal(chat.color, '#abcdef');
  assert.equal(chat.source, 'chat');
  const proj = C.resolveColor({ chatId: 'c', projectId: 'p', projectAutoIndex: 1, rank: 0 });
  assert.equal(proj.source, 'project');
  assert.equal(proj.base, C.autoColor(1));
  const auto = C.resolveColor({ chatId: 'c', autoIndex: 4 });
  assert.equal(auto.color, C.autoColor(4));
  assert.equal(auto.source, 'default');
  assert.equal(C.resolveColor({ chatId: 'c', override: 'nope' }).source, 'default');
});

test('fallbacks without stored data are deterministic', () => {
  const a = C.resolveColor({ chatId: 'same' });
  assert.deepEqual(a, C.resolveColor({ chatId: 'same' }));
  const p = C.resolveColor({ chatId: 'same', projectId: 'p' });
  assert.deepEqual(p, C.resolveColor({ chatId: 'same', projectId: 'p' }));
});

test('names make sense to a person', () => {
  assert.equal(C.nameFor('#ef4444'), 'Red');
  assert.equal(C.nameFor('#93C5FD'), 'Light blue');
  assert.equal(C.nameFor('#3b80f0'), 'Custom (close to blue)');
  assert.equal(C.nameFor('#ff0000'), 'Custom (close to red)');
  assert.equal(C.nameFor('#00ff00'), 'Custom (close to lime)');
});

test('describe explains where a color came from', () => {
  assert.equal(C.describe(C.resolveColor({ chatId: 'c', autoIndex: 1 })), 'Blue · automatic');
  assert.equal(C.describe(C.resolveColor({ chatId: 'c', override: '#22c55e' })), 'Green · picked by you');
  assert.equal(C.describe(C.resolveColor({ chatId: 'c', projectId: 'p', projectOverride: '#a855f7', rank: 0 })), 'Purple project · newest chat, full color');
  assert.equal(C.describe(C.resolveColor({ chatId: 'c', projectId: 'p', projectOverride: '#a855f7', rank: 2 })), 'Purple project · #3 newest, 54% strength');
});

test('pill text stays readable on every color, faded or not, light or dark page', () => {
  const all = [...C.SWATCHES.map((s) => s.hex)];
  for (const bg of [LIGHT_BG, DARK_BG]) {
    for (const base of C.AUTO) {
      for (let rank = 0; rank < C.FADE.length; rank++) {
        all.push(C.resolveColor({ chatId: 'x', projectId: 'p', projectOverride: base, rank, background: bg }).color);
      }
    }
  }
  // The pill label is bold; 4:1 is comfortably readable (indigo #6366f1 tops out at 4.47:1 with either black or white).
  for (const c of all) {
    const ratio = C.contrastRatio(c, C.textColorFor(c));
    assert.ok(ratio >= 4, `${c} contrast ${ratio.toFixed(2)}`);
  }
});

test('css color parsing and blending', () => {
  assert.equal(C.cssToHex('rgb(38, 38, 36)'), '#262624');
  assert.equal(C.cssToHex('rgba(255, 255, 255, 1)'), '#ffffff');
  assert.equal(C.cssToHex('rgba(0, 0, 0, 0)'), null, 'transparent is ignored');
  assert.equal(C.cssToHex('garbage'), null);
  assert.equal(C.blend('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(C.blend('#ef4444', '#ffffff', 1), '#ef4444');
});
