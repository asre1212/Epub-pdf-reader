# Marginalia — EPUB & PDF reader

An offline-first progressive web app for reading EPUB and PDF books, highlighting
as you go, and keeping every highlight from every book in one notebook.

Everything lives on the device. There is no account, no server, and no upload:
books, highlights and reading positions are stored in IndexedDB, and the app
shell plus both rendering engines are precached so the whole thing works with the
network off.

## What it does

**Library tab** — import books from the Files app, iCloud Drive, Google Drive, or
anywhere else the system file picker can reach. You can also drag files onto the
window, share a book to the app from the Android share sheet, or open one with
the app from the desktop "Open with" menu. Covers and titles are read from the
book itself (EPUB metadata, or the first page rendered for a PDF), and re-importing
a file you already have is detected by content hash rather than duplicated.

**Reading** — select any text and a colour picker appears right next to it; one tap
saves the highlight. Tap an existing highlight to recolour it, attach a note, copy
it, or remove it. The contents drawer lists both the table of contents and the
highlights you have made in the book so far.

**Settings** — theme (light, sepia, dark, black), text size, line spacing,
typeface, letter spacing, justification, page margin, and how pages scroll:
page turns or one continuous column for EPUBs, snap-to-page or continuous scroll
for PDFs. PDFs additionally get a zoom control and a fit-width/fit-page choice.
Settings apply live and are remembered between sessions.

**Notes tab** — every highlight from every book, grouped by book and sorted by
title, compiled into a single notepad. Search the text and notes, filter by book
or colour, show only annotated highlights, edit notes in place, and copy or export
the whole thing as Markdown or plain text. Tapping a highlight jumps to it in the
book.

**Updates** — the ⓘ button in the library header opens About, which shows the
running version and a *Check for updates* / *Update now* pair. Updates also
install on their own: the app checks on launch, hourly, whenever you return to
it, and when the connection comes back. A new version downloads in the
background and is applied the moment you are not mid-book — never while a book
is open. Turn *Install updates automatically* off and you get a banner with an
Update button instead, and nothing reloads until you press it. Either way your
library, highlights and settings are untouched: they live in IndexedDB, not in
the cache the update replaces.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the production build
```

A service worker only registers over HTTPS or on `localhost`, so use `npm run
preview` (or a real HTTPS host) to exercise installation and offline behaviour.

### Installing

Open the built app in a browser and use *Install app* / *Add to Home Screen*.
Once installed it launches standalone, registers as a handler for `.epub` and
`.pdf` files on desktop, and appears in the Android share sheet for books.

## How it is put together

| Path | Purpose |
| --- | --- |
| `src/App.jsx` | Tab shell, import pipeline, and the single source of truth for books, highlights and settings |
| `src/components/Library.jsx` | Book grid, search, sort, rename/delete |
| `src/components/Notes.jsx` | The compiled notepad, filters and export |
| `src/components/Reader.jsx` | Reader chrome: title bar, progress, settings sheet, contents drawer |
| `src/components/EpubView.jsx` | epub.js rendition, CFI-anchored highlights, typography and flow |
| `src/components/PdfView.jsx` / `PdfPage.jsx` | pdf.js canvas + selectable text layer, lazy page rendering, rect-anchored highlights |
| `src/lib/db.js` | IndexedDB stores: `books`, `files`, `highlights`, `prefs` |
| `src/lib/importBook.js` | Format detection, metadata and cover extraction, de-duplication |
| `src/lib/pdfRects.js` | Turns a DOM selection into page-relative highlight boxes |
| `src/lib/appUpdates.js` | Service worker lifecycle: version checks, the update state, and when a new build is applied |
| `src/components/AboutSheet.jsx` / `UpdateBanner.jsx` | Version and update UI |
| `src/sw.js` | Precaching, offline navigation, the skip-waiting handler, and the Web Share Target |

### Anchoring highlights

EPUB highlights are stored as **EPUB CFI ranges**, so they survive changes to text
size, margin, typeface and flow — the same highlight is repainted wherever the
text reflows to. PDF highlights are stored as **page-relative rectangles**
(fractions of the page box), so they survive zooming and window resizing.

### Updates

The worker is registered in *prompt* mode, so a new build installs and then
waits rather than swapping itself in under a page that is being read.
`src/lib/appUpdates.js` decides when to hand over: it watches the registration
directly (so a version found by the browser or another tab counts too), posts
`SKIP_WAITING`, and reloads on `controllerchange`. Because the reload is driven
from the app rather than from the registration helper, it behaves the same
however the update was discovered.

Deployments must serve `index.html`, `sw.js` and `manifest.webmanifest` with
`Cache-Control: no-cache`; the hashed files under `assets/` can be cached
forever.

### Offline

`src/sw.js` precaches the app shell, both engines, the pdf.js worker, and the
standard fonts, colour profile and wasm decoders that pdf.js fetches at runtime —
about 3.6 MB in total. CJK CMaps are large and only needed by some books, so they
are cached the first time a book actually asks for one. Book files themselves are
never fetched: they are read from IndexedDB.

### A note on pdf.js

The app uses pdf.js's `legacy` build. The modern build relies on very new
JavaScript built-ins that current Safari and iOS do not have yet; the legacy build
ships the polyfills and behaves identically. PDF rendering is also configured
without eval and without XFA, so a book cannot run scripts of its own.
