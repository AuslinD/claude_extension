// In-memory chrome.* for Node tests of src/storage.js and src/background.js.
// Usage: const chrome = installFakeChrome({ local: {...} }); ... chrome.storage.local._data
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const event = () => {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), _fire: (...args) => Promise.all(fns.map((fn) => fn(...args))) };
};

function area(name, seed, onChanged) {
  const data = clone(seed || {});
  return {
    _data: data,
    async get(keys) {
      if (keys == null) return clone(data);
      const out = {};
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      await onChanged._fire(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in data) changes[k] = { oldValue: clone(data[k]) };
        delete data[k];
      }
      await onChanged._fire(changes, name);
    },
  };
}

function installFakeChrome(seed = {}) {
  const onChanged = event();
  const action = { _badge: {} };
  for (const fn of ['setBadgeText', 'setBadgeBackgroundColor', 'setTitle']) action[fn] = async (o) => Object.assign(action._badge, o);
  globalThis.chrome = {
    storage: { sync: area('sync', seed.sync, onChanged), local: area('local', seed.local, onChanged), onChanged },
    runtime: { onStartup: event(), onInstalled: event() },
    commands: { onCommand: event() },
    action,
  };
  return globalThis.chrome;
}

module.exports = { installFakeChrome };
