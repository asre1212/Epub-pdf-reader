import { openDB } from 'idb';

const DB_NAME = 'marginalia';
const DB_VERSION = 1;

/**
 * Object stores:
 *   books      — one record per imported book (metadata + cover + reading progress)
 *   files      — the raw EPUB/PDF blob, keyed by book id, kept separate so the
 *                library list can be read without pulling megabytes into memory
 *   highlights — every highlight, indexed by book
 *   prefs      — reader settings and other small key/value state
 */
let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('addedAt', 'addedAt');
          books.createIndex('lastOpenedAt', 'lastOpenedAt');
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('highlights')) {
          const hl = db.createObjectStore('highlights', { keyPath: 'id' });
          hl.createIndex('bookId', 'bookId');
          hl.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('prefs')) {
          db.createObjectStore('prefs');
        }
      },
    });
  }
  return dbPromise;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ books */

export async function listBooks() {
  const db = await getDB();
  const books = await db.getAll('books');
  return books.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt));
}

export async function getBook(id) {
  return (await getDB()).get('books', id);
}

export async function putBook(book) {
  await (await getDB()).put('books', book);
  return book;
}

export async function updateBook(id, patch) {
  const db = await getDB();
  const tx = db.transaction('books', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done;
    return null;
  }
  const next = { ...existing, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function saveBookFile(id, blob) {
  await (await getDB()).put('files', { id, blob });
}

export async function getBookFile(id) {
  const rec = await (await getDB()).get('files', id);
  return rec?.blob ?? null;
}

/** Removes a book together with its file and every highlight in it. */
export async function deleteBook(id) {
  const db = await getDB();
  const tx = db.transaction(['books', 'files', 'highlights'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  const index = tx.objectStore('highlights').index('bookId');
  for await (const cursor of index.iterate(IDBKeyRange.only(id))) {
    cursor.delete();
  }
  await tx.done;
}

/** True when a byte-identical file is already in the library. */
export async function findBookByFingerprint(fingerprint) {
  if (!fingerprint) return null;
  const books = await (await getDB()).getAll('books');
  return books.find((b) => b.fingerprint === fingerprint) || null;
}

/* -------------------------------------------------------------- highlights */

export async function listHighlights(bookId) {
  const db = await getDB();
  if (bookId) return db.getAllFromIndex('highlights', 'bookId', bookId);
  return db.getAll('highlights');
}

export async function putHighlight(highlight) {
  await (await getDB()).put('highlights', highlight);
  return highlight;
}

export async function updateHighlight(id, patch) {
  const db = await getDB();
  const tx = db.transaction('highlights', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done;
    return null;
  }
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteHighlight(id) {
  await (await getDB()).delete('highlights', id);
}

/* ------------------------------------------------------------------- prefs */

export async function getPref(key, fallback = null) {
  const value = await (await getDB()).get('prefs', key);
  return value === undefined ? fallback : value;
}

export async function setPref(key, value) {
  await (await getDB()).put('prefs', value, key);
}

/* ------------------------------------------------------------------ export */

/** Rough on-disk usage, for the library footer. */
export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
