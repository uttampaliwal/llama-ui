import type { Conversation, Preset } from './types.js';

type StoredPreset = Preset & { name: string };

const DB_NAME = 'llama-ui';
const DB_VERSION = 1;
const STORE_CONVERSATIONS = 'conversations';
const STORE_PRESETS = 'presets';

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
          db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_PRESETS)) {
          db.createObjectStore(STORE_PRESETS, { keyPath: 'name' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE_CONVERSATIONS, mode).objectStore(STORE_CONVERSATIONS);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDB();
  const store = tx(db, 'readonly');
  return reqToPromise(store.getAll() as IDBRequest<Conversation[]>);
}

export async function putConversation(conv: Conversation): Promise<void> {
  const db = await getDB();
  const store = tx(db, 'readwrite');
  store.put(conv);
  await txDone(store);
}

export async function putConversations(convs: Conversation[]): Promise<void> {
  const db = await getDB();
  const store = tx(db, 'readwrite');
  for (const c of convs) store.put(c);
  await txDone(store);
}

export async function deleteConversationById(id: string): Promise<void> {
  const db = await getDB();
  const store = tx(db, 'readwrite');
  store.delete(id);
  await txDone(store);
}

export async function getPresets(): Promise<Record<string, Preset>> {
  const db = await getDB();
  const store = tx(db, 'readonly');
  const arr = await reqToPromise(store.getAll() as IDBRequest<StoredPreset[]>);
  if (arr && arr.length) {
    const map: Record<string, Preset> = {};
    for (const p of arr) map[p.name] = p;
    return map;
  }
  // One-time migration from legacy localStorage store
  try {
    const raw = localStorage.getItem('presets');
    if (raw) {
      const v = JSON.parse(raw);
      const map = (v && typeof v === 'object' ? v : {}) as Record<string, Preset>;
      localStorage.removeItem('presets');
      await putPresets(map);
      return map;
    }
  } catch (e) {
    console.warn('Migration of presets from localStorage failed:', e);
  }
  return {};
}

export async function putPresets(presets: Record<string, Preset>): Promise<void> {
  const db = await getDB();
  const store = tx(db, 'readwrite');
  for (const name of Object.keys(presets)) {
    store.put({ name, ...presets[name] } as StoredPreset);
  }
  await txDone(store);
}

export async function savePreset(name: string, preset: Preset): Promise<void> {
  const db = await getDB();
  const store = tx(db, 'readwrite');
  store.put({ name, ...preset } as StoredPreset);
  await txDone(store);
}

export async function deletePresetByName(name: string): Promise<void> {
  const db = await getDB();
  const store = tx(db, 'readwrite');
  store.delete(name);
  await txDone(store);
}

function txDone(store: IDBObjectStore): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = store.transaction;
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
