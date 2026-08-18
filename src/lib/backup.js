import { APP_VERSION } from './appUpdates.js';
import { listBooks, listHighlights, putBook, putHighlight, newId } from './db.js';

export const BACKUP_FORMAT = 'marginalia-notes-backup';
export const BACKUP_VERSION = 1;

/**
 * A backup carries every highlight plus enough of each book's identity to put
 * them back. The book files themselves are deliberately left out — they are the
 * large part, and the user already has them. On restore, books are matched by
 * content fingerprint (or title and author), and a book that is not in the
 * library yet is recreated as a placeholder that adopts the real file the next
 * time it is imported.
 */
function bookIdentity(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author || '',
    format: book.format,
    fingerprint: book.fingerprint || null,
    fileName: book.fileName || '',
    language: book.language || '',
    publisher: book.publisher || '',
    pageCount: book.pageCount ?? null,
    size: book.size ?? null,
    addedAt: book.addedAt ?? null,
    location: book.location ?? null,
    progress: book.progress ?? 0,
  };
}

/** Builds the backup payload for the given highlights (all of them by default). */
export async function buildBackup(highlights) {
  const [allBooks, allHighlights] = await Promise.all([listBooks(), listHighlights()]);
  const chosen = highlights || allHighlights;
  const usedBookIds = new Set(chosen.map((h) => h.bookId));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    counts: { books: usedBookIds.size, highlights: chosen.length },
    books: allBooks.filter((book) => usedBookIds.has(book.id)).map(bookIdentity),
    highlights: chosen,
  };
}

export async function downloadBackup(highlights) {
  const backup = await buildBackup(highlights);
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `marginalia-notes-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup.counts;
}

function normalise(value) {
  return (value || '').trim().toLowerCase();
}

/** Something already in the library that this backed-up book refers to. */
function matchBook(backupBook, library) {
  if (backupBook.fingerprint) {
    const byFingerprint = library.find((b) => b.fingerprint === backupBook.fingerprint);
    if (byFingerprint) return byFingerprint;
  }
  const byId = library.find((b) => b.id === backupBook.id);
  if (byId) return byId;
  return (
    library.find(
      (b) =>
        normalise(b.title) === normalise(backupBook.title) &&
        normalise(b.author) === normalise(backupBook.author) &&
        b.format === backupBook.format,
    ) || null
  );
}

/**
 * Identifies a mark by where it sits and what it covers, so a restore can tell
 * an already-present highlight from a new one without comparing every pair.
 * The locator is part of the key: the same sentence can legitimately be
 * highlighted on two different pages.
 */
function highlightKey(highlight) {
  const locator = highlight.format === 'pdf' ? `p${highlight.page}` : `c${highlight.cfi || ''}`;
  return `${highlight.bookId}|${locator}|${normalise(highlight.text)}`;
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a readable backup.');
  }
  if (data?.format !== BACKUP_FORMAT || !Array.isArray(data.highlights)) {
    throw new Error('That file is not a Marginalia notes backup.');
  }
  if (Number(data.version) > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of the app.');
  }
  return data;
}

/**
 * Merges a backup into the library. Nothing is deleted and nothing is
 * overwritten: highlights already present are left alone, so restoring the same
 * file twice is harmless.
 */
export async function restoreBackup(file) {
  const data = parseBackup(await file.text());

  const library = await listBooks();
  const existing = await listHighlights();
  const existingIds = new Set(existing.map((h) => h.id));
  const existingKeys = new Set(existing.map(highlightKey));

  // Backup book id -> the library book its highlights should attach to.
  const target = new Map();
  const placeholders = [];

  for (const backupBook of data.books || []) {
    const match = matchBook(backupBook, library);
    if (match) {
      target.set(backupBook.id, match);
      continue;
    }
    // Recreate the book without its file. The reader explains that the file is
    // missing, and importing it later reattaches it to these same highlights.
    const placeholder = {
      ...backupBook,
      id: backupBook.id || newId(),
      cover: null,
      locations: null,
      addedAt: backupBook.addedAt || Date.now(),
      lastOpenedAt: null,
      progress: backupBook.progress || 0,
      restoredFromBackup: true,
      missingFile: true,
    };
    await putBook(placeholder);
    library.push(placeholder);
    target.set(backupBook.id, placeholder);
    placeholders.push(placeholder);
  }

  let restored = 0;
  let skipped = 0;
  let orphaned = 0;

  for (const highlight of data.highlights) {
    const book = target.get(highlight.bookId);
    if (!book) {
      orphaned += 1;
      continue;
    }
    const candidate = { ...highlight, bookId: book.id };
    const key = highlightKey(candidate);
    if (existingIds.has(candidate.id) || existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    if (!candidate.id) candidate.id = newId();
    await putHighlight(candidate);
    existingIds.add(candidate.id);
    existingKeys.add(key);
    restored += 1;
  }

  return {
    restored,
    skipped,
    orphaned,
    placeholders: placeholders.map((b) => b.title),
    exportedAt: data.exportedAt || null,
  };
}
