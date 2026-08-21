import {
  deleteHighlight,
  getPref,
  listBooks,
  listHighlights,
  listTombstones,
  newId,
  pruneTombstones,
  putBook,
  putHighlight,
  listProjects,
  putProject,
  deleteProject,
  listSummaries,
  putSummary,
  getSummary,
  setPref,
  updateBook,
} from './db.js';
import { decryptRecord, deriveIdentity, encryptRecord, normaliseSyncCode } from './syncCrypto.js';

/**
 * Keeps reading positions and highlights in step across devices.
 *
 * Records are keyed by the book's content fingerprint, never by its local id:
 * the same EPUB imported on a phone and on a tablet gets a different id on each,
 * but the same SHA-256. That is what makes positions line up without the book
 * files themselves ever being uploaded.
 *
 * Everything is encrypted before it leaves (see syncCrypto.js), so the server
 * stores opaque blobs.
 */

const CONFIG_KEY = 'sync-config';
const STATE_KEY = 'sync-state';
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000; // long enough for a device that has been off for a season

const DEFAULT_CONFIG = { enabled: false, endpoint: '', code: '' };
const DEFAULT_STATE = { cursor: 0, lastPushAt: 0, lastSyncAt: 0, lastError: null };

let inFlight = null;
const listeners = new Set();

export function subscribeToSync(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(status) {
  for (const listener of listeners) listener(status);
}

export async function getSyncConfig() {
  return { ...DEFAULT_CONFIG, ...((await getPref(CONFIG_KEY, null)) || {}) };
}

export async function getSyncState() {
  return { ...DEFAULT_STATE, ...((await getPref(STATE_KEY, null)) || {}) };
}

export async function saveSyncConfig(patch) {
  const next = { ...(await getSyncConfig()), ...patch };
  if (next.code) next.code = normaliseSyncCode(next.code) || next.code;
  await setPref(CONFIG_KEY, next);
  announce({ kind: 'config', config: next });
  return next;
}

/** Starting fresh, or joining a different code, invalidates the cursor. */
export async function resetSyncState() {
  await setPref(STATE_KEY, { ...DEFAULT_STATE });
}

export function syncUrl(endpoint, path) {
  const base = (endpoint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('No sync server address set.');
  return `${base}${path}`;
}

/* ------------------------------------------------------------- what to send */

function bookByFingerprint(books) {
  const map = new Map();
  for (const book of books) if (book.fingerprint) map.set(book.fingerprint, book);
  return map;
}

/**
 * Local changes since the last push. A highlight carries enough about its book
 * to be placed on a device that has not imported that book yet.
 */
async function collectChanges(since) {
  const [books, highlights, projects, summaries, tombstones] = await Promise.all([
    listBooks(),
    listHighlights(),
    listProjects(),
    listSummaries(),
    listTombstones(),
  ]);
  const booksById = new Map(books.map((b) => [b.id, b]));
  const records = [];

  for (const book of books) {
    if (!book.fingerprint || !book.positionAt || book.positionAt <= since) continue;
    records.push({
      id: `pos:${book.fingerprint}`,
      clientAt: book.positionAt,
      value: {
        kind: 'position',
        fingerprint: book.fingerprint,
        location: book.location ?? null,
        progress: book.progress ?? 0,
        positionAt: book.positionAt,
        title: book.title,
        author: book.author || '',
        format: book.format,
      },
    });
  }

  for (const highlight of highlights) {
    const changedAt = highlight.updatedAt || highlight.createdAt || 0;
    if (changedAt <= since) continue;
    const book = booksById.get(highlight.bookId);
    if (!book?.fingerprint) continue; // nothing to anchor it to on another device
    records.push({
      id: `hl:${highlight.id}`,
      clientAt: changedAt,
      value: {
        kind: 'highlight',
        fingerprint: book.fingerprint,
        book: { title: book.title, author: book.author || '', format: book.format },
        highlight: { ...highlight, bookId: undefined, updatedAt: changedAt },
      },
    });
  }

  for (const project of projects) {
    const changedAt = project.updatedAt || project.createdAt || 0;
    if (changedAt <= since) continue;
    records.push({
      id: `pj:${project.id}`,
      clientAt: changedAt,
      value: { kind: 'project', project: { ...project, updatedAt: changedAt } },
    });
  }

  // A study sheet travels by the book's fingerprint, like its reading position:
  // the other device may hold that book under a different id.
  for (const record of summaries) {
    const changedAt = record.updatedAt || 0;
    if (changedAt <= since) continue;
    const book = booksById.get(record.id);
    if (!book?.fingerprint) continue;
    records.push({
      id: `sm:${book.fingerprint}`,
      clientAt: changedAt,
      value: {
        kind: 'summary',
        fingerprint: book.fingerprint,
        summary: { ...record, id: undefined, updatedAt: changedAt },
      },
    });
  }

  for (const grave of tombstones) {
    if (grave.deletedAt <= since) continue;
    // Tombstones written before projects existed can only be highlights.
    const prefix = grave.kind === 'project' ? 'pj' : 'hl';
    records.push({ id: `${prefix}:${grave.id}`, clientAt: grave.deletedAt, deleted: true });
  }

  return records;
}

/* ------------------------------------------------------------ what came back */

async function applyPosition(value, books) {
  const book = bookByFingerprint(books).get(value.fingerprint);
  if (!book) return 0; // the book is not on this device; nothing to move
  if ((book.positionAt || 0) >= value.positionAt) return 0;
  await updateBook(book.id, {
    location: value.location,
    progress: value.progress,
    positionAt: value.positionAt,
  });
  return 1;
}

async function applyHighlight(value, books, existingById) {
  let book = bookByFingerprint(books).get(value.fingerprint);
  if (!book) {
    // Same shape the backup restore uses: keep the note, mark the book as
    // having no file, and let a later import adopt it.
    book = {
      id: newId(),
      format: value.book?.format || 'epub',
      fileName: '',
      size: null,
      fingerprint: value.fingerprint,
      title: value.book?.title || 'Untitled',
      author: value.book?.author || '',
      cover: null,
      addedAt: Date.now(),
      lastOpenedAt: null,
      location: null,
      progress: 0,
      locations: null,
      restoredFromSync: true,
      missingFile: true,
    };
    await putBook(book);
    books.push(book);
  }

  const incoming = { ...value.highlight, bookId: book.id };
  const local = existingById.get(incoming.id);
  if (local && (local.updatedAt || local.createdAt || 0) >= (incoming.updatedAt || 0)) return 0;
  await putHighlight(incoming);
  existingById.set(incoming.id, incoming);
  return 1;
}

/**
 * A project is only a name, so the newer name wins outright. A project that
 * arrives because a highlight was filed into it is created on the spot: the
 * alternative is a note that knows where it belongs and a device that does not.
 */
async function applyProject(value, projectsById) {
  const incoming = value.project;
  if (!incoming?.id) return 0;
  const local = projectsById.get(incoming.id);
  if (local && (local.updatedAt || local.createdAt || 0) >= (incoming.updatedAt || 0)) return 0;
  const saved = await putProject(incoming);
  projectsById.set(saved.id, saved);
  return 1;
}

/**
 * A Cornell sheet from another device. Written prose, so the newer version of
 * the whole record wins rather than merging field by field — two devices
 * editing the same summary band is a conflict no merge rule improves.
 */
async function applySummary(value, books) {
  const book = bookByFingerprint(books).get(value.fingerprint);
  if (!book) return 0; // the book is not here; nothing to attach it to
  const local = await getSummary(book.id);
  if ((local?.updatedAt || 0) >= (value.summary?.updatedAt || 0)) return 0;
  await putSummary({ ...value.summary, id: book.id });
  return 1;
}

async function applyIncoming(records, key) {
  const books = await listBooks();
  const existing = await listHighlights();
  const existingById = new Map(existing.map((h) => [h.id, h]));
  const projectsById = new Map((await listProjects()).map((p) => [p.id, p]));
  let applied = 0;

  for (const record of records) {
    try {
      if (record.deleted) {
        const id = record.id.slice(3);
        if (record.id.startsWith('pj:')) {
          if (!projectsById.has(id)) continue;
          // remote: this device is learning about the deletion, not making it
          await deleteProject(id, { remote: true });
          projectsById.delete(id);
          applied += 1;
          continue;
        }
        if (existingById.has(id)) {
          await deleteHighlight(id, { remote: true });
          existingById.delete(id);
          applied += 1;
        }
        continue;
      }
      const value = await decryptRecord(key, record.payload);
      if (value.kind === 'position') applied += await applyPosition(value, books);
      else if (value.kind === 'project') applied += await applyProject(value, projectsById);
      else if (value.kind === 'summary') applied += await applySummary(value, books);
      else if (value.kind === 'highlight') applied += await applyHighlight(value, books, existingById);
    } catch (err) {
      // One unreadable record must not stop the rest. The usual cause is a
      // different sync code, which the caller is told about below.
      console.warn('Skipped a record that could not be applied', record.id, err);
    }
  }
  return applied;
}

/* --------------------------------------------------------------- the round */

/**
 * One push-and-pull. Returns a summary; never throws for ordinary failures such
 * as being offline, which are reported through the returned status instead.
 */
export async function syncNow({ force = false } = {}) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const config = await getSyncConfig();
    if (!config.enabled || !config.code || !config.endpoint) {
      return { ok: false, skipped: 'not-configured' };
    }
    if (!navigator.onLine && !force) return { ok: false, skipped: 'offline' };

    announce({ kind: 'start' });
    const state = await getSyncState();
    const startedAt = Date.now();

    try {
      const { accountId, key } = await deriveIdentity(config.code);
      const changes = await collectChanges(state.lastPushAt);

      const records = await Promise.all(
        changes.map(async (change) =>
          change.deleted
            ? { id: change.id, clientAt: change.clientAt, deleted: true }
            : {
                id: change.id,
                clientAt: change.clientAt,
                payload: await encryptRecord(key, change.value),
              },
        ),
      );

      const response = await fetch(syncUrl(config.endpoint, '/v1/sync'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: accountId, since: state.cursor, records }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `Sync server returned ${response.status}.`);
      }

      const result = await response.json();
      const applied = await applyIncoming(result.records || [], key);

      const next = {
        cursor: result.cursor ?? state.cursor,
        lastPushAt: startedAt,
        lastSyncAt: Date.now(),
        lastError: null,
      };
      await setPref(STATE_KEY, next);
      await pruneTombstones(startedAt - TOMBSTONE_TTL);

      const summary = {
        ok: true,
        pushed: records.length,
        received: (result.records || []).length,
        applied,
        more: !!result.more,
      };
      announce({ kind: 'done', summary, state: next });
      return summary;
    } catch (err) {
      const message = err?.message || 'Sync failed.';
      await setPref(STATE_KEY, { ...state, lastError: message });
      announce({ kind: 'error', message });
      return { ok: false, error: message };
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Removes everything this code has stored on the server. */
export async function forgetOnServer() {
  const config = await getSyncConfig();
  if (!config.code || !config.endpoint) return { ok: false, error: 'Sync is not set up.' };
  const { accountId } = await deriveIdentity(config.code);
  const response = await fetch(syncUrl(config.endpoint, '/v1/forget'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: accountId }),
  });
  if (!response.ok) return { ok: false, error: `Server returned ${response.status}.` };
  await resetSyncState();
  return { ok: true };
}

export async function checkServer(endpoint) {
  const response = await fetch(syncUrl(endpoint, '/v1/health'));
  if (!response.ok) throw new Error(`Server returned ${response.status}.`);
  const body = await response.json();
  if (body?.service !== 'marginalia-sync') throw new Error('That is not a Marginalia sync server.');
  return true;
}
