function createReferenceDeck(storage) {
  const key = 'polya.reference-deck.v1';
  let state;
  try { state = JSON.parse(storage.getItem(key)); } catch { /* Storage is optional. */ }

  function save() {
    try { storage.setItem(key, JSON.stringify(state)); } catch { /* Keep the session queue. */ }
  }

  function sync(catalog, current) {
    const ids = [...new Set(catalog.map(item => item.id))].sort();
    const available = new Set(ids);
    const validList = list => Array.isArray(list) && list.every(id => available.has(id)) && new Set(list).size === list.length;
    if (JSON.stringify(ids) === JSON.stringify(state?.ids) && validList(state.queue) && validList(state.recent)) return;
    const recent = [...new Set((Array.isArray(state?.recent) ? state.recent : []).filter(id => available.has(id) && id !== current))];
    if (available.has(current)) recent.push(current);
    state = {ids, queue: refill(ids.filter(id => id !== current), recent, ids.length), recent: recent.slice(-5)};
    save();
  }

  function refill(ids, history, size) {
    const pool = [...ids];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const queue = [];
    const gap = Math.min(Math.max(size - 1, 0), 5);
    while (pool.length) {
      const recent = gap ? [...history, ...queue].slice(-gap) : [];
      const index = pool.findIndex(id => !recent.includes(id));
      queue.push(...pool.splice(Math.max(index, 0), 1));
    }
    return queue;
  }

  function peek(catalog, current) {
    sync(catalog, current);
    if (!state.queue.length) {
      state.queue = refill(state.ids, state.recent, state.ids.length);
      save();
    }
    return catalog.find(item => item.id === state.queue[0]);
  }

  function advance(id) {
    if (state?.queue[0] !== id) return;
    state.queue.shift();
    state.recent = [...state.recent.filter(previous => previous !== id), id].slice(-5);
    save();
  }
  return {sync, peek, advance};
}
