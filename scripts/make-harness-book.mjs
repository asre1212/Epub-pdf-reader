/**
 * Builds the two test books the browser harness reads.
 *
 * Highlighting is a gesture landing on a particular word, so the fixtures have
 * to be predictable down to the word: every one is named for where it sits
 * (`word3x17` is the eighteenth word of paragraph 4), which lets a test say
 * what it expected to select rather than only that it selected something. The
 * EPUB carries two chapters so the continuous-scroll manager has more than one
 * section on screen at a time — the case that broke highlighting.
 *
 * The books are generated rather than committed: they are large, they are
 * uninteresting, and `public/` is shipped. Run this before the harness:
 *
 *     node scripts/make-harness-book.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const para = (n) =>
  `<p>Paragraph ${n}. ` +
  Array.from({ length: 40 }, (_, i) => `word${n}x${i}`).join(' ') +
  ' The quick brown fox jumps over the lazy dog again and again.</p>';

const chapter = (n, count) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head>
<body><h1>Chapter ${n}</h1>${Array.from({ length: count }, (_, i) => para(i + 1)).join('\n')}</body></html>`;

async function epub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:test-book</dc:identifier>
<dc:title>Harness Book</dc:title><dc:creator>Test</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li><li><a href="c2.xhtml">Chapter 2</a></li></ol></nav></body></html>`);
  zip.file('OEBPS/c1.xhtml', chapter(1, 25));
  zip.file('OEBPS/c2.xhtml', chapter(2, 25));

  const buf = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
  writeFileSync(join(OUT, 'harness-book.epub'), buf);
  return buf.length;
}

async function pdf() {
  // Printed by the browser rather than assembled here: the point of the PDF
  // fixture is pdf.js's text layer, and a hand-rolled file would be testing
  // this script's idea of one. Playwright is the harness's own dependency, not
  // the app's, so it is asked for only when this half runs.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return false;
  }

  // The title is what the library lists the book under, and the harness clicks
  // it by name; without one the reader falls back to the source URL.
  const body = Array.from({ length: 24 }, (_, n) => para(n)).join('\n');
  const html = `<html><head><title>Harness Book</title></head>
<body style="font:16px/1.6 Georgia,serif;padding:40px"><h1>Harness Book</h1>${body}</body></html>`;

  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.pdf({ path: join(OUT, 'harness-book.pdf'), format: 'A4' });
  } finally {
    await browser.close();
  }
  return true;
}

console.log('epub:', await epub(), 'bytes');
console.log(
  (await pdf())
    ? 'pdf: written'
    : 'pdf: skipped — needs playwright (npm i -D playwright), set CHROMIUM_PATH if the browser lives outside it',
);
