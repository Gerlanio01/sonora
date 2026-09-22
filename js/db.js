// Persistência local (IndexedDB) — downloads offline, curtidas, playlists, recentes
const DB_NAME = 'sonora';
const DB_VERSION = 1;
const STORES = ['downloads', 'likes', 'recents', 'playlists', 'meta'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB indisponível neste navegador'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Falha ao abrir o banco'));
    req.onblocked = () => reject(new Error('Banco de dados bloqueado'));
  });
  return dbPromise;
}

function reqp(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(storeName, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
  });
  return result;
}

export const idb = {
  getAll: (name) => run(name, 'readonly', (st) => reqp(st.getAll())),
  get: (name, key) => run(name, 'readonly', (st) => reqp(st.get(key))),
  put: (name, value) => run(name, 'readwrite', (st) => reqp(st.put(value))),
  del: (name, key) => run(name, 'readwrite', (st) => reqp(st.delete(key))),
  clear: (name) => run(name, 'readwrite', (st) => reqp(st.clear())),
  count: (name) => run(name, 'readonly', (st) => reqp(st.count())),
};

/* ============================ Downloads ============================ */
export const downloads = {
  async list() {
    const all = await idb.getAll('downloads');
    return all.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  },
  async get(id) { return idb.get('downloads', String(id)); },
  async has(id) { return !!(await idb.get('downloads', String(id))); },
  async add(record) { await idb.put('downloads', record); },
  async remove(id) { await idb.del('downloads', String(id)); },
  async clear() { await idb.clear('downloads'); },
  async count() { return idb.count('downloads'); },
  async ids() {
    const all = await idb.getAll('downloads');
    return new Set(all.map((r) => String(r.id)));
  },
  async totalBytes() {
    const all = await idb.getAll('downloads');
    return all.reduce((sum, r) => sum + (r.size || 0), 0);
  },
};

/* ============================= Curtidas ============================ */
export const likes = {
  async list() {
    const all = await idb.getAll('likes');
    return all.sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0)).map((r) => r.track).filter(Boolean);
  },
  async has(id) { return !!(await idb.get('likes', String(id))); },
  async ids() {
    const all = await idb.getAll('likes');
    return new Set(all.map((r) => String(r.id)));
  },
  async toggle(track) {
    const key = String(track.id);
    const current = await idb.get('likes', key);
    if (current) {
      await idb.del('likes', key);
      return false;
    }
    await idb.put('likes', { id: key, track, likedAt: Date.now() });
    return true;
  },
  async count() { return idb.count('likes'); },
  async clear() { return idb.clear('likes'); },
};

/* ========================== Tocadas recentes ======================= */
export const recents = {
  async push(track) {
    if (!track?.id) return;
    const key = String(track.id);
    await idb.put('recents', { id: key, track, playedAt: Date.now() });
    const all = await idb.getAll('recents');
    if (all.length > 80) {
      all.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
      for (const old of all.slice(80)) await idb.del('recents', old.id);
    }
  },
  async list(limit = 30) {
    const all = await idb.getAll('recents');
    return all
      .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))
      .slice(0, limit)
      .map((r) => r.track)
      .filter(Boolean);
  },
  async clear() { return idb.clear('recents'); },
  async count() { return idb.count('recents'); },
};

/* ============================ Playlists ============================ */
export const playlists = {
  async list() {
    const all = await idb.getAll('playlists');
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
  async get(id) { return idb.get('playlists', String(id)); },
  async create(name) {
    const playlist = {
      id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (name || '').trim() || 'Nova playlist',
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await idb.put('playlists', playlist);
    return playlist;
  },
  async rename(id, name) {
    const p = await this.get(id);
    if (!p) return null;
    p.name = (name || '').trim() || p.name;
    p.updatedAt = Date.now();
    await idb.put('playlists', p);
    return p;
  },
  async remove(id) { await idb.del('playlists', String(id)); },
  async addTrack(id, track) {
    const p = await this.get(id);
    if (!p) return null;
    if (!p.tracks.some((t) => String(t.id) === String(track.id))) {
      p.tracks.push(track);
      p.updatedAt = Date.now();
      await idb.put('playlists', p);
      return true;
    }
    return false;
  },
  async removeTrack(id, trackId) {
    const p = await this.get(id);
    if (!p) return null;
    p.tracks = p.tracks.filter((t) => String(t.id) !== String(trackId));
    p.updatedAt = Date.now();
    await idb.put('playlists', p);
    return p;
  },
  async count() { return idb.count('playlists'); },
};

/* ================= Preferências (localStorage, síncrono) =========== */
const PREFS_KEY = 'sonora.prefs';

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}

export const prefs = {
  get(key, fallback = null) {
    const all = readPrefs();
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
  },
  set(key, value) {
    const all = readPrefs();
    all[key] = value;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(all)); } catch { /* cota cheia */ }
  },
  all() { return readPrefs(); },
  remove(key) {
    const all = readPrefs();
    delete all[key];
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  },
};

/* ======================== Espaço em disco ========================== */
export async function storageInfo() {
  let usage = 0;
  let quota = 0;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage || 0;
      quota = est.quota || 0;
    }
  } catch { /* navegador sem suporte */ }
  const downloadBytes = await downloads.totalBytes().catch(() => 0);
  return {
    usage,
    quota,
    downloadBytes,
    pct: quota ? Math.min(100, (usage / quota) * 100) : 0,
  };
}

/** Pedir ao navegador para não descartar os dados baixados */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      if (granted) return true;
    }
  } catch { /* ignore */ }
  return false;
}
