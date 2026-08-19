import { APP_VERSION } from './appUpdates.js';
import {
  listBooks,
  listHighlights,
  listProjects,
  putBook,
  putHighlight,
  putProject,
  newId,
} from './db.js';

export const BACKUP_FORMAT = 'marginalia-notes-backup';
export const BACKUP_VERSION = 2;

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
  const [allBooks, allHighlights, allProjects] = await Promise.all([
    listBooks(),
    listHighlights(),
    listProjects(),
  ]);
  const chosen = highlights || allHighlights;
  const usedBookIds = new Set(chosen.map((h) => h.bookId));
  // Only the projects these highlights are actually filed under: a backup of
  // one book's notes should not carry the reader's whole filing system.
  const usedProjectIds = new Set(chosen.map((h) => h.projectId).filter(Boolean));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    counts: {
      books: usedBookIds.size,
      highlights: chosen.length,
      projects: usedProjectIds.size,
    },
    books: allBooks.filter((book) => usedBookIds.has(book.id)).map(bookIdentity),
    projects: allProjects.filter((project) => usedProjectIds.has(project.id)),
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

  // Backup project id -> the project its highlights should be filed under. A
  // project already here by id or by name is reused rather than duplicated:
  // restoring the same notes on a device that already sorted them should not
  // leave two folders called Thesis.
  const projects = await listProjects();
  const projectTarget = new Map();
  for (const backupProject of data.projects || []) {
    if (!backupProject?.id) continue;
    const match =
      projects.find((p) => p.id === backupProject.id) ||
      projects.find((p) => normalise(p.name) === normalise(backupProject.name));
    if (match) {
      projectTarget.set(backupProject.id, match.id);
      continue;
    }
    const created = await putProject({ ...backupProject, restoredFromBackup: true });
    projects.push(created);
    projectTarget.set(backupProject.id, created.id);
  }

  const existingById = new Map(existing.map((h) => [h.id, h]));
  const existingByKey = new Map(existing.map((h) => [highlightKey(h), h]));

  let restored = 0;
  let skipped = 0;
  let refiled = 0;
  let orphaned = 0;

  for (const highlight of data.highlights) {
    const book = target.get(highlight.bookId);
    if (!book) {
      orphaned += 1;
      continue;
    }
    const candidate = { ...highlight, bookId: book.id };
    if (candidate.projectId) {
      // A highlight whose project did not come with the backup is restored
      // unfiled rather than pointing at nothing.
      candidate.projectId = projectTarget.get(candidate.projectId) ?? null;
    }
    const key = highlightKey(candidate);
    const already = existingById.get(candidate.id) || existingByKey.get(key);
    if (already) {
      // Leaving a highlight alone is right for its text, its colour and its
      // note, which the reader may have changed since. Its filing is different:
      // if it is sitting unfiled and the backup knows where it belongs, putting
      // it back fills a gap rather than overwriting a choice. That is the whole
      // reason to restore a backup after losing a project.
      if (candidate.projectId && !already.projectId) {
        await putHighlight({ ...already, projectId: candidate.projectId, updatedAt: Date.now() });
        already.projectId = candidate.projectId;
        refiled += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    if (!candidate.id) candidate.id = newId();
    await putHighlight(candidate);
    existingById.set(candidate.id, candidate);
    existingByKey.set(key, candidate);
    restored += 1;
  }

  return {
    restored,
    skipped,
    refiled,
    orphaned,
    projects: projectTarget.size,
    placeholders: placeholders.map((b) => b.title),
    exportedAt: data.exportedAt || null,
  };
}
