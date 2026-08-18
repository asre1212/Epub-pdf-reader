import ePub from 'epubjs';
import {
  findBookByFingerprint,
  newId,
  putBook,
  saveBookFile,
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

/**
 * Turns a picked File into a library record. Returns
 * `{ book, duplicate }` — `duplicate` is true when the same bytes were already
 * imported, in which case the existing book is returned untouched.
 */
export async function importFile(file) {
  const format = detectFormat(file);
  if (!format) {
    throw new Error(`${file.name || 'That file'} is not an EPUB or PDF.`);
  }

  const blob = file instanceof Blob ? file : new Blob([file]);
  const fingerprint = await fingerprintBlob(blob);
  const existing = await findBookByFingerprint(fingerprint);
  if (existing) return { book: existing, duplicate: true };

  const meta =
    format === 'epub' ? await readEpubMetadata(blob, file) : await readPdfMetadata(blob, file);

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
  const errors = [];
  for (const file of files) {
    try {
      const { book, duplicate } = await importFile(file);
      (duplicate ? duplicates : added).push(book);
    } catch (err) {
      errors.push({ name: file.name || 'file', message: err?.message || String(err) });
    }
  }
  return { added, duplicates, errors };
}
