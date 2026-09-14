import {
  mergeRemoteRecord,
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
const DEFAULT_STATE = { protocol: 2, cursor: { seq: 0, id: '' }, lastPushAt: 0, lastSyncAt: 0, lastError: null };

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
  const stored = await getPref(STATE_KEY, null);
  return stored?.protocol === 2 ? { ...DEFAULT_STATE, ...stored } : { ...DEFAULT_STATE };
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
        book: { title: book.title, author: book.author || '', format: book.format },
        summary: { ...record, id: undefined, updatedAt: changedAt },
      },
    });
  }

  for (const grave of tombstones) {
    if (grave.deletedAt <= since) continue;
    // Tombstones written before projects existed can only be highlights.
    const prefix = grave.kind === 'project' ? 'pj' : grave.kind === 'summary' ? 'sm' : 'hl';
    records.push({ id: `${prefix}:${grave.id}`, clientAt: grave.deletedAt, deleted: true });
  }

  return records;
}

/* ------------------------------------------------------------ what came back */

async function applyIncoming(records, key) {
  let applied = 0;
  for (const record of records) {
    const value = record.deleted ? null : await decryptRecord(key, record.payload);
    // A failed write or decrypt must prevent cursor advancement; retry is idempotent.
    applied += await mergeRemoteRecord(record, value);
  }
  return applied;
}

export function batchRecords(records, maxBytes = 1800000) {
  const batches = [];
  let batch = [], bytes = 256;
  for (const record of records) {
    const size = new TextEncoder().encode(JSON.stringify(record)).length + 1;
    if (size + 256 > maxBytes) throw new Error('A sync record is too large.');
    if (batch.length && (batch.length >= 500 || bytes + size > maxBytes)) {
      batches.push(batch); batch = []; bytes = 256;
    }
    batch.push(record); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
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

      const batches = batchRecords(records);
      if (!batches.length) batches.push([]);
      let cursor = state.cursor, applied = 0, received = 0;
      for (const batch of batches) {
        let more;
        let outgoing = batch;
        do {
          const response = await fetchWithTimeout(syncUrl(config.endpoint, '/v2/sync'), {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ account: accountId, since: cursor, records: outgoing }),
          });
          if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(response.status === 404
              ? 'Update your sync worker to the current version before syncing.'
              : detail.error || 'Sync server returned ' + response.status + '.');
          }
          const result = await response.json();
          if (result.protocol !== 2 || !Number.isFinite(result.cursor?.seq) || typeof result.cursor?.id !== 'string') {
            throw new Error('The sync server returned an invalid cursor.');
          }
          applied += await applyIncoming(result.records || [], key);
          received += (result.records || []).length;
          more = !!result.more;
          if (more && JSON.stringify(cursor) === JSON.stringify(result.cursor)) throw new Error('Sync did not advance. Please retry.');
          cursor = result.cursor;
          outgoing = [];
        } while (more);
      }
      const next = {
        protocol: 2, cursor, lastPushAt: startedAt - 1,
        lastSyncAt: Date.now(), lastError: null,
      };
      await setPref(STATE_KEY, next);
      // Keep deletion markers: an offline device may return after any length of time.
      const summary = { ok: true, pushed: records.length, received, applied, more: false };
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
  const response = await fetchWithTimeout(syncUrl(config.endpoint, '/v1/forget'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: accountId }),
  });
  if (!response.ok) return { ok: false, error: `Server returned ${response.status}.` };
  await saveSyncConfig({ enabled: false });
  await resetSyncState();
  return { ok: true };
}

export async function checkServer(endpoint) {
  const response = await fetchWithTimeout(syncUrl(endpoint, '/v1/health'));
  if (!response.ok) throw new Error(`Server returned ${response.status}.`);
  const body = await response.json();
  if (body?.service !== 'marginalia-sync') throw new Error('That is not a Marginalia sync server.');
  return true;
}
