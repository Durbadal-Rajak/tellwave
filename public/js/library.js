// The library: saved audio lives in this browser (IndexedDB). No account, no server.

const DB_NAME = "tellwave";
const STORE = "items";
let dbPromise = null;
let memory = null; // fallback when IndexedDB is unavailable (some private windows)

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => { memory = memory ?? new Map(); throw err; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const isPersistent = async () => { try { await openDb(); return true; } catch { return false; } };

export async function addItem(item) {
  const full = { id: crypto.randomUUID(), createdAt: Date.now(), ...item };
  try { await tx("readwrite", (s) => wrap(s.put(full))); }
  catch { (memory ??= new Map()).set(full.id, full); }
  return full;
}

export async function listItems() {
  let items;
  try { items = await tx("readonly", (s) => wrap(s.getAll())); }
  catch { items = [...(memory ?? new Map()).values()]; }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteItem(id) {
  try { await tx("readwrite", (s) => wrap(s.delete(id))); }
  catch { memory?.delete(id); }
}

export async function countItems() {
  try { return await tx("readonly", (s) => wrap(s.count())); }
  catch { return memory?.size ?? 0; }
}
