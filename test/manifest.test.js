// Every file the extension loads exists, and the release zip includes it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = require('../manifest.json');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function htmlRefs(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => path.posix.join(path.posix.dirname(file), m[1]));
}

test('manifest: content scripts, styles, worker and pages exist', () => {
  const files = [
    ...manifest.content_scripts.flatMap((c) => c.js.concat(c.css || [])),
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
  ];
  for (const f of files) assert.ok(exists(f), f);
});

test('manifest: activity.js loads before the modules that use it', () => {
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf('src/activity.js') < js.indexOf('src/storage.js'));
  assert.ok(js.indexOf('src/activity.js') < js.indexOf('src/content.js'));
});

test('extension pages: every script / stylesheet they reference exists', () => {
  for (const page of ['popup/popup.html', 'stats/stats.html']) {
    for (const ref of htmlRefs(page)) assert.ok(exists(ref), `${page} -> ${ref}`);
  }
});

test('worker: importScripts targets exist next to it', () => {
  const src = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
  const m = /importScripts\(([^)]*)\)/.exec(src);
  for (const f of m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1))) {
    assert.ok(exists(path.posix.join(path.posix.dirname(manifest.background.service_worker), f)), f);
  }
});

test('package.sh: zip includes every folder the extension loads from', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'tools/package.sh'), 'utf8');
  const zipLine = sh.split('\n').find((l) => l.startsWith('zip '));
  for (const dir of ['src', 'popup', 'stats', 'icons']) assert.match(zipLine, new RegExp(`\\b${dir}\\b`), dir);
});
