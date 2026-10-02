// Minimal in-memory stand-in for the chrome.* APIs the content script uses (fixture only).
(function () {
  const listeners = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function area(name, seed) {
    const data = clone(seed || {});
    const emit = (changes) => setTimeout(() => listeners.forEach((fn) => fn(changes, name)), 0);
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
        emit(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const k of [].concat(keys)) {
          if (k in data) {
            changes[k] = { oldValue: clone(data[k]) };
            delete data[k];
          }
        }
        emit(changes);
      },
    };
  }

  const seed = (window.CCC_TEST && window.CCC_TEST.seed) || {};
  window.chrome = {
    runtime: { id: 'fixture', onMessage: { addListener() {} } },
    storage: {
      sync: area('sync', seed.sync),
      local: area('local', seed.local),
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
})();
