import ePub from 'epubjs';
import {
  findBookByFingerprint,
  hasBookFile,
  listBooks,
  newId,
  putBook,
  saveBookFile,
  updateBook,
} from './db.js';
import { fingerprintBlob } from './fingerprint.js';
import { closePdf, openPdf } from './pdf.js';

const EPUB_EXT = /\.epub$/i;
const PDF_EXT = /\.pdf$/i;

export function detectFormat(file) {
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';
  if (type === 'application/epub+zip' || EPUB_EXT.test(name)) return 'epub';
  if (type === 'application/pdf' || PDF_EXT.test(name)) return 'pdf';
  return null;
}

export const ACCEPTED_TYPES = '.epub,.pdf,application/epub+zip,application/pdf';

function titleFromFilename(name = '') {
  const base = name.replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim();
  return base || 'Untitled';
}

/** Renders the first page of a PDF to a small cover image. */
async function pdfCover(pdf) {
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(600 / base.width, 900 / base.height, 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const canvasContext = canvas.getContext('2d', { alpha: false });
    canvasContext.fillStyle = '#ffffff';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext, viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75));
    page.cleanup();
    return blob;
  } catch {
    return null;
  }
}

async function readPdfMetadata(blob, file) {
  const pdf = await openPdf(blob);
  let info = {};
  try {
    ({ info = {} } = await pdf.getMetadata());
  } catch {
    /* metadata is optional */
  }
  const cover = await pdfCover(pdf);
  const meta = {
    title: (info.Title || '').trim() || titleFromFilename(file.name),
    author: (info.Author || '').trim() || '',
    pageCount: pdf.numPages,
    cover,
  };
  await closePdf(pdf);
  return meta;
}

async function readEpubMetadata(blob, file) {
  const book = ePub(await blob.arrayBuffer());
  let meta = { title: titleFromFilename(file.name), author: '', cover: null };
  try {
    await book.ready;
    const packaging = book.packaging?.metadata || {};
    meta.title = (packaging.title || '').trim() || meta.title;
    meta.author = (packaging.creator || '').trim() || '';
    meta.language = packaging.language || '';
    meta.publisher = packaging.publisher || '';
    meta.spineLength = book.spine?.length ?? 0;

    const url = await book.coverUrl();
    if (url) {
      try {
        meta.cover = await (await fetch(url)).blob();
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch (err) {
    console.warn('Could not read EPUB metadata', err);
  } finally {
    book.destroy();
  }
  return meta;
}

function sameTitle(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

/**
 * A book restored from a notes backup exists as a record with no file. When the
 * real file turns up, it belongs to that record rather than to a new one, so the
 * restored highlights are still attached to it.
 */
async function findPlaceholder({ fingerprint, title, author, format }) {
  const books = await listBooks();
  const candidates = [];
  for (const book of books) {
    if (book.format !== format) continue;
    if (fingerprint && book.fingerprint && book.fingerprint !== fingerprint) continue;
    if (!(await hasBookFile(book.id))) candidates.push(book);
  }
  return (
    candidates.find((book) => sameTitle(book.title, title) && sameTitle(book.author, author)) ||
    candidates.find((book) => sameTitle(book.title, title)) ||
    null
  );
}

/**
 * Turns a picked File into a library record. Returns `{ book, duplicate,
 * adopted }` — `duplicate` when the same bytes are already in the library,
 * `adopted` when the file filled in a book that had been restored from a backup
 * without it.
 */
export async function importFile(file) {
  const format = detectFormat(file);
  if (!format) {
    throw new Error(`${file.name || 'That file'} is not an EPUB or PDF.`);
  }

  const blob = file instanceof Blob ? file : new Blob([file]);
  const fingerprint = await fingerprintBlob(blob);
  const existing = await findBookByFingerprint(fingerprint);
  if (existing && (await hasBookFile(existing.id))) {
    return { book: existing, duplicate: true };
  }

  const meta =
    format === 'epub' ? await readEpubMetadata(blob, file) : await readPdfMetadata(blob, file);

  const placeholder = existing || (await findPlaceholder({ ...meta, fingerprint, format }));
  if (placeholder) {
    await saveBookFile(placeholder.id, blob);
    const book = await updateBook(placeholder.id, {
      fingerprint: fingerprint || placeholder.fingerprint || null,
      size: blob.size,
      fileName: file.name || placeholder.fileName,
      cover: placeholder.cover || meta.cover || null,
      pageCount: placeholder.pageCount ?? meta.pageCount ?? null,
      title: placeholder.title || meta.title,
      author: placeholder.author || meta.author || '',
      missingFile: false,
    });
    return { book: book || placeholder, duplicate: false, adopted: true };
  }

  const book = {
    id: newId(),
    format,
    fileName: file.name || `book.${format}`,
    size: blob.size,
    fingerprint,
    title: meta.title,
    author: meta.author,
    language: meta.language || '',
    publisher: meta.publisher || '',
    pageCount: meta.pageCount || null,
    cover: meta.cover || null,
    addedAt: Date.now(),
    lastOpenedAt: null,
    // Reading position: an EPUB CFI or a PDF page number, plus a 0–1 fraction.
    location: null,
    progress: 0,
    locations: null, // cached epub.js locations, generated on first read
  };

  await saveBookFile(book.id, blob);
  await putBook(book);
  return { book, duplicate: false };
}

/** Imports several files, collecting per-file errors instead of aborting. */
export async function importFiles(files) {
  const added = [];
  const duplicates = [];
  const adopted = [];
  const errors = [];
  for (const file of files) {
    try {
      const { book, duplicate, adopted: reattached } = await importFile(file);
      if (duplicate) duplicates.push(book);
      else if (reattached) adopted.push(book);
      else added.push(book);
    } catch (err) {
      errors.push({ name: file.name || 'file', message: err?.message || String(err) });
    }
  }
  return { added, duplicates, adopted, errors };
}
