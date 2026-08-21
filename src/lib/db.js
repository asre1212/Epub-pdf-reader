import { openDB } from 'idb';

const DB_NAME = 'marginalia';
const DB_VERSION = 4;

/**
 * Object stores:
 *   books      — one record per imported book (metadata + cover + reading progress)
 *   files      — the raw EPUB/PDF blob, keyed by book id, kept separate so the
 *                library list can be read without pulling megabytes into memory
 *   highlights — every highlight, indexed by book
 *   projects   — reader-made folders that cut across books; a highlight names
 *                one through `projectId`, or none and it is unfiled
 *   summaries  — the Cornell study sheet for a book: what the reader wrote in
 *                the summary bands, keyed by book. Kept out of `books` because
 *                it is authored work, not metadata, and syncs on its own terms
 *   prefs      — reader settings and other small key/value state
 *   tombstones — ids of deleted highlights and projects, so a deletion can be
 *                synced. Without them a delete on one device is undone by the
 *                next sync from the other, which still has the record.
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
        if (!db.objectStoreNames.contains('projects')) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' });
          projects.createIndex('order', 'order');
        }
        if (!db.objectStoreNames.contains('summaries')) {
          db.createObjectStore('summaries', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('prefs')) {
          db.createObjectStore('prefs');
        }
        if (!db.objectStoreNames.contains('tombstones')) {
          const graves = db.createObjectStore('tombstones', { keyPath: 'id' });
          graves.createIndex('deletedAt', 'deletedAt');
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

/**
 * Whether a book's file is stored, without reading it. Fetching the record would
 * pull the whole book into memory, which matters when checking several at once.
 */
export async function hasBookFile(id) {
  const key = await (await getDB()).getKey('files', id);
  return key !== undefined;
}

/** Removes a book together with its file and every highlight in it. */
export async function deleteBook(id) {
  const db = await getDB();
  const tx = db.transaction(
    ['books', 'files', 'highlights', 'summaries', 'tombstones'],
    'readwrite',
  );
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  tx.objectStore('summaries').delete(id);
  const index = tx.objectStore('highlights').index('bookId');
  const graves = tx.objectStore('tombstones');
  const now = Date.now();
  for await (const cursor of index.iterate(IDBKeyRange.only(id))) {
    graves.put({ id: cursor.value.id, bookId: id, deletedAt: now });
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
  const record = { updatedAt: highlight.createdAt ?? Date.now(), ...highlight };
  await (await getDB()).put('highlights', record);
  return record;
}

/**
 * Puts a deleted highlight back, tombstone and all.
 *
 * A plain `putHighlight` is not enough to undo a delete: the tombstone survives
 * it and the next sync would faithfully broadcast the deletion to every device,
 * including this one. The record is stamped as written now so it also wins
 * against any copy of the deletion already in flight.
 */
export async function restoreHighlight(highlight) {
  const record = { ...highlight, updatedAt: Date.now() };
  const db = await getDB();
  const tx = db.transaction(['highlights', 'tombstones'], 'readwrite');
  tx.objectStore('tombstones').delete(record.id);
  tx.objectStore('highlights').put(record);
  await tx.done;
  return record;
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

/**
 * Removes a highlight and remembers that it was removed. `remote` deletions come
 * from another device, which already knows, so they leave no tombstone.
 */
export async function deleteHighlight(id, { remote = false } = {}) {
  const db = await getDB();
  const tx = db.transaction(['highlights', 'tombstones'], 'readwrite');
  const existing = await tx.objectStore('highlights').get(id);
  tx.objectStore('highlights').delete(id);
  if (!remote) {
    tx.objectStore('tombstones').put({
      id,
      kind: 'highlight',
      bookId: existing?.bookId ?? null,
      deletedAt: Date.now(),
    });
  }
  await tx.done;
}

/* -------------------------------------------------------------- summaries */

/**
 * The written half of a Cornell sheet: one summary for the book and one for
 * each of its sections. Stored per book and keyed by section title rather than
 * by highlight, because a summary outlives any single highlight in it — delete
 * the quotation and what you concluded from it should still be there.
 */
export async function listSummaries() {
  return (await getDB()).getAll('summaries');
}

export async function getSummary(bookId) {
  return (await getDB()).get('summaries', bookId);
}

export async function saveSummary(bookId, patch) {
  const db = await getDB();
  const tx = db.transaction('summaries', 'readwrite');
  const existing = (await tx.store.get(bookId)) || { id: bookId, summary: '', chapters: {} };
  const next = {
    ...existing,
    ...patch,
    chapters: { ...existing.chapters, ...(patch.chapters || {}) },
    id: bookId,
    updatedAt: Date.now(),
  };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function putSummary(summary) {
  const record = { chapters: {}, summary: '', ...summary, updatedAt: summary.updatedAt ?? Date.now() };
  await (await getDB()).put('summaries', record);
  return record;
}

/* --------------------------------------------------------------- projects */

/**
 * Projects are the reader's own filing, so they keep the order they were put
 * in rather than being sorted for them. `order` is only a hint: ties fall back
 * to the name so a list built on two devices still reads the same.
 */
export async function listProjects() {
  const projects = await (await getDB()).getAll('projects');
  return projects.sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export async function putProject(project) {
  const record = {
    order: 0,
    createdAt: Date.now(),
    ...project,
    name: (project.name || '').trim(),
    updatedAt: project.updatedAt ?? Date.now(),
  };
  await (await getDB()).put('projects', record);
  return record;
}

export async function updateProject(id, patch) {
  const db = await getDB();
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done;
    return null;
  }
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  if (typeof next.name === 'string') next.name = next.name.trim();
  await tx.store.put(next);
  await tx.done;
  return next;
}

/**
 * Removes a project and unfiles what was in it.
 *
 * Deleting a folder must never delete what it held: the highlights are the
 * reader's work and the project is only a label on it. The highlights are
 * stamped as changed so the other devices learn they came loose, rather than
 * quietly refiling them the next time they sync.
 */
export async function deleteProject(id, { remote = false } = {}) {
  const db = await getDB();
  const tx = db.transaction(['projects', 'highlights', 'tombstones'], 'readwrite');
  tx.objectStore('projects').delete(id);

  const highlights = tx.objectStore('highlights');
  const freed = [];
  for await (const cursor of highlights.iterate()) {
    if (cursor.value.projectId !== id) continue;
    const next = { ...cursor.value, projectId: null, updatedAt: Date.now() };
    cursor.update(next);
    freed.push(next);
  }

  if (!remote) {
    tx.objectStore('tombstones').put({ id, kind: 'project', deletedAt: Date.now() });
  }
  await tx.done;
  return freed;
}

/** Files several highlights at once — the only bearable way to sort a backlog. */
export async function assignProject(highlightIds, projectId) {
  const db = await getDB();
  const tx = db.transaction('highlights', 'readwrite');
  const wanted = new Set(highlightIds);
  const changed = [];
  for (const id of wanted) {
    const existing = await tx.store.get(id);
    if (!existing || existing.projectId === (projectId || null)) continue;
    const next = { ...existing, projectId: projectId || null, updatedAt: Date.now() };
    tx.store.put(next);
    changed.push(next);
  }
  await tx.done;
  return changed;
}

export async function listTombstones() {
  return (await getDB()).getAll('tombstones');
}

/** Tombstones only exist to be synced; drop them once every device has seen one. */
export async function pruneTombstones(before) {
  const db = await getDB();
  const tx = db.transaction('tombstones', 'readwrite');
  for await (const cursor of tx.store.index('deletedAt').iterate(IDBKeyRange.upperBound(before))) {
    cursor.delete();
  }
  await tx.done;
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
