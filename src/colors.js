// Pure color logic: named palette, automatic color assignment, project fading, overrides.
//
// How colors are chosen (in priority order):
//   1. A color you picked for the chat.
//   2. Chat is in a project: the project's color, faded by the chat's position in the project
//      (newest chat = full color, each older one more transparent, down to 26%).
//   3. Otherwise: the next color from AUTO, handed out in a rotation so neighbors differ.
(function (root) {
  'use strict';

  // Picker grid: one column per color family, rows light / normal / dark.
  const FAMILIES = [
    ['Red', '#fca5a5', '#ef4444', '#b91c1c'],
    ['Orange', '#fdba74', '#f97316', '#c2410c'],
    ['Amber', '#fcd34d', '#f59e0b', '#b45309'],
    ['Yellow', '#fde047', '#eab308', '#a16207'],
    ['Lime', '#bef264', '#84cc16', '#4d7c0f'],
    ['Green', '#86efac', '#22c55e', '#15803d'],
    ['Emerald', '#6ee7b7', '#10b981', '#047857'],
    ['Teal', '#5eead4', '#14b8a6', '#0f766e'],
    ['Cyan', '#67e8f9', '#06b6d4', '#0e7490'],
    ['Sky', '#7dd3fc', '#0ea5e9', '#0369a1'],
    ['Blue', '#93c5fd', '#3b82f6', '#1d4ed8'],
    ['Indigo', '#a5b4fc', '#6366f1', '#4338ca'],
    ['Violet', '#c4b5fd', '#8b5cf6', '#6d28d9'],
    ['Purple', '#d8b4fe', '#a855f7', '#7e22ce'],
    ['Magenta', '#f0abfc', '#d946ef', '#a21caf'],
    ['Pink', '#f9a8d4', '#ec4899', '#be185d'],
    ['Rose', '#fda4af', '#f43f5e', '#be123c'],
    ['Brown', '#deb887', '#a0522d', '#5d3a1a'],
    ['Gray', '#cbd5e1', '#64748b', '#334155'],
  ];
  const ROWS = ['Light', '', 'Dark'];

  // [{ hex, name, family, row }] in grid order (row-major: all light, all normal, all dark)
  const SWATCHES = [];
  ROWS.forEach((prefix, r) => {
    for (const fam of FAMILIES) {
      const name = prefix ? `${prefix} ${fam[0].toLowerCase()}` : fam[0];
      SWATCHES.push({ hex: fam[r + 1], name, family: fam[0], row: r });
    }
  });

  // Automatic colors: 12 colors with plain names that are all clearly different from each other
  // (min CIE76 ΔE ≈ 27), ordered so consecutive ones contrast strongly.
  const AUTO = ['#ef4444', '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#06b6d4',
    '#eab308', '#ec4899', '#1d4ed8', '#84cc16', '#a0522d', '#64748b'];

  // Opacity by position inside a project (0 = newest). Older chats share the last step.
  const FADE = [1, 0.74, 0.54, 0.38, 0.26];

  // FNV-1a 32-bit + murmur3 finalizer
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function isHex(hex) {
    return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex);
  }

  function hexToRgb(hex) {
    if (!isHex(hex)) return null;
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex({ r, g, b }) {
    const to = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  }

  // "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0)" -> "#010203" (null if transparent or unparsable)
  function cssToHex(css) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(css || '');
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < 0.5)) return null;
    return rgbToHex({ r: +m[1], g: +m[2], b: +m[3] });
  }

  // Paint `hex` at `alpha` opacity over `background`, as a solid color.
  function blend(hex, background, alpha) {
    const a = hexToRgb(hex), b = hexToRgb(background) || { r: 255, g: 255, b: 255 };
    if (!a) return background;
    return rgbToHex({ r: a.r * alpha + b.r * (1 - alpha), g: a.g * alpha + b.g * (1 - alpha), b: a.b * alpha + b.b * (1 - alpha) });
  }

  function rgbToLab(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }

  // Perceptual distance (CIE76). ~2 = barely noticeable, >20 = clearly different colors.
  function deltaE(a, b) {
    const A = rgbToLab(a), B = rgbToLab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  }

  // Human name for any color: exact palette name, or "Custom (close to Teal)".
  function nameFor(hex) {
    if (!isHex(hex)) return 'Unknown';
    hex = hex.toLowerCase();
    const exact = SWATCHES.find((s) => s.hex === hex);
    if (exact) return exact.name;
    let best = SWATCHES[0], bd = Infinity;
    for (const s of SWATCHES) {
      const d = deltaE(hex, s.hex);
      if (d < bd) { bd = d; best = s; }
    }
    return `Custom (close to ${best.name.toLowerCase()})`;
  }

  function autoColor(index) {
    const n = AUTO.length;
    return AUTO[((index % n) + n) % n];
  }

  function hashIndex(id) {
    return hash32(String(id)) % AUTO.length;
  }

  function fadeFor(rank) {
    return FADE[Math.max(0, Math.min(FADE.length - 1, rank | 0))];
  }

  // Returns { color: solid hex to paint, base: the undiluted color, alpha, source, rank }
  //   override          chat's own color (wins)
  //   projectId         chat's project, if grouping is on
  //   projectOverride   color picked for the project
  //   projectAutoIndex  project's slot in AUTO (falls back to a hash)
  //   rank              chat's position in its project, 0 = newest (falls back to a hash)
  //   autoIndex         chat's slot in AUTO (falls back to a hash)
  //   background        page background the faded color sits on
  function resolveColor(o) {
    const background = isHex(o.background) ? o.background : '#ffffff';
    if (isHex(o.override)) {
      const c = o.override.toLowerCase();
      return { color: c, base: c, alpha: 1, source: 'chat', rank: null };
    }
    if (o.projectId) {
      const base = isHex(o.projectOverride)
        ? o.projectOverride.toLowerCase()
        : autoColor(o.projectAutoIndex ?? hashIndex(o.projectId));
      const rank = Number.isInteger(o.rank) ? o.rank : hash32(String(o.chatId)) % 4;
      const alpha = fadeFor(rank);
      return { color: blend(base, background, alpha), base, alpha, source: 'project', rank };
    }
    const c = autoColor(o.autoIndex ?? hashIndex(o.chatId));
    return { color: c, base: c, alpha: 1, source: 'default', rank: null };
  }

  // One-line, human explanation of where a color came from.
  function describe(info) {
    if (info.source === 'chat') return `${nameFor(info.base)} · picked by you`;
    if (info.source === 'project') {
      const pos = info.rank === 0 ? 'newest chat, full color' : `#${info.rank + 1} newest, ${Math.round(info.alpha * 100)}% strength`;
      return `${nameFor(info.base)} project · ${pos}`;
    }
    return `${nameFor(info.base)} · automatic`;
  }

  function luminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }

  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function textColorFor(hex) {
    return contrastRatio(hex, '#111111') >= contrastRatio(hex, '#ffffff') ? '#111111' : '#ffffff';
  }

  const api = {
    FAMILIES, SWATCHES, AUTO, FADE,
    hash32, isHex, hexToRgb, rgbToHex, cssToHex, blend, rgbToLab, deltaE, nameFor,
    autoColor, hashIndex, fadeFor, resolveColor, describe,
    luminance, contrastRatio, textColorFor,
  };
  root.CCC = root.CCC || {};
  root.CCC.colors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
