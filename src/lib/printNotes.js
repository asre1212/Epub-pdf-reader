/**
 * Exports the notepad as a PDF through the browser's own print pipeline.
 *
 * This produces a better document than a hand-rolled PDF writer could: the text
 * is laid out and hyphenated by the browser, and every script the reader might
 * highlight in — Japanese, Arabic, Cyrillic, Greek — comes out with the right
 * glyphs, which a PDF built from the standard fonts could not manage without
 * shipping megabytes of font data.
 *
 * The document title becomes the suggested filename, so it is swapped for the
 * duration of the print.
 */
export function printNotes(filename = 'Highlights') {
  const previous = document.title;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };

  document.title = filename;
  window.addEventListener('afterprint', restore);
  // Safari does not always fire afterprint; do not leave the tab renamed.
  setTimeout(restore, 60000);

  try {
    window.print();
    return true;
  } catch {
    restore();
    return false;
  }
}

export const canPrint = typeof window !== 'undefined' && typeof window.print === 'function';
