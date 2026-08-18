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
or colour, show only annotated highlights, and edit notes in place. Tapping a
highlight jumps to it in the book.

**Export & backup** — the *Export* button covers whatever the current filters
show, in the order shown:

- **PDF** — a formatted document, one section per book, with the highlight
  colour down the margin and the note and reference under each quote.
- **Markdown** or **plain text** — for a notes app, or for anywhere else.
- **Save a backup** — a JSON file holding every highlight with its colour, note,
  chapter or page, and its exact anchor. Book files are not included; they are
  the large part and you already have them.
- **Restore from a backup** — merges a backup back in. Nothing is deleted and
  nothing is overwritten, so restoring the same file twice is harmless. Books
  are matched by content fingerprint, or by title and author. A book that is not
  in the library yet is listed as *notes only*; import that file later and its
  highlights reattach to it automatically.

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

## Deploying

`.github/workflows/deploy.yml` builds the app and publishes `dist/` to GitHub
Pages on every push to `main` or the feature branch, and can be run by hand from
the Actions tab.

**The repository's Pages source must be set to "GitHub Actions"** — Settings →
Pages → Build and deployment → Source. Pointing Pages at a branch instead serves
the repository as-is, and `index.html` loads `/src/main.jsx`, which only exists
as JSX for Vite to compile; the result is a blank page.

The build needs no base-path configuration for a project site served from a
repository subpath. Vite is configured with `base: './'`, so
every asset reference, the manifest's `start_url` and `scope`, the service worker
scope, and the pdf.js runtime asset lookups are all relative to wherever
`index.html` lands.

One caveat specific to Pages: it serves HTML with `Cache-Control: max-age=600`
and does not let you change response headers, so a new version can take up to ten
minutes to be noticed. On a host you control, serve `index.html`, `sw.js` and
`manifest.webmanifest` with `Cache-Control: no-cache` for immediate updates; the
hashed files under `assets/` can be cached forever either way.

### Installing

Open the built app in a browser and use *Install app* / *Add to Home Screen*.
Once installed it launches standalone with its own icon, registers as a handler
for `.epub` and `.pdf` files on desktop, and appears in the Android share sheet
for books.

### The app icon

`public/icon.svg` is the master artwork. The PNGs beside it in `public/icons/`
are rendered from it and committed:

| File | Used by |
| --- | --- |
| `apple-touch-icon.png` (180) | iOS *Add to Home Screen* — square and opaque, because iOS rounds the corners itself |
| `icon-192.png`, `icon-512.png` | Manifest, `purpose: any` — full-bleed, for launchers that do not re-crop |
| `icon-maskable-512.png` | Manifest, `purpose: maskable` — same art shrunk into the 80% safe circle so an Android launcher can crop it to any shape without clipping the book |

Regenerate them after editing the SVG:

```bash
node scripts/generate-icons.mjs
```

Rasterising needs a browser engine, which is not worth a build dependency, so
the script uses Playwright only if it is already installed (`npm i -D
playwright`) and otherwise leaves the committed PNGs alone. Set `CHROMIUM_PATH`
if Playwright has not downloaded a browser of its own.

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
| `src/lib/importBook.js` | Format detection, metadata and cover extraction, de-duplication, adopting restored books |
| `src/lib/pdfRects.js` | Turns a DOM selection into page-relative highlight boxes |
| `src/lib/backup.js` | Building, parsing and merging notes backups |
| `src/lib/printNotes.js` / `components/NotesPrintSheet.jsx` | The PDF export: a print-only rendition of the notepad |
| `src/lib/appUpdates.js` | Service worker lifecycle: version checks, the update state, and when a new build is applied |
| `src/components/AboutSheet.jsx` / `UpdateBanner.jsx` | Version and update UI |
| `src/sw.js` | Precaching, offline navigation, the skip-waiting handler, and the Web Share Target |
| `.github/workflows/deploy.yml` | Builds and publishes the site to GitHub Pages |

### Anchoring highlights

EPUB highlights are stored as **EPUB CFI ranges**, so they survive changes to text
size, margin, typeface and flow — the same highlight is repainted wherever the
text reflows to. PDF highlights are stored as **page-relative rectangles**
(fractions of the page box), so they survive zooming and window resizing.

### The PDF export

There is no PDF-writing library involved. `NotesPrintSheet` renders the notepad
as a plain document beside the app, hidden on screen and revealed by the print
stylesheet, and *Export as PDF* calls `window.print()` — so the browser's own
print dialog is where you choose *Save as PDF*.

That is a deliberate choice over generating the file directly. The browser lays
out and hyphenates the text, and every script somebody might highlight in —
Japanese, Arabic, Cyrillic, Greek — comes out with the right glyphs. A PDF built
from the standard fonts is limited to WinAnsi and would silently mangle all of
them, and fixing that means shipping font files measured in megabytes.

A side effect worth knowing: the browser's own Print command in the Notes tab
produces exactly the same document.

### Backups

A backup is `{ format, version, exportedAt, books, highlights }`. The books carry
identity only — title, author, format, content fingerprint — never the file
bytes. `restoreBackup` matches each one against the library by fingerprint, then
by title and author, and recreates anything missing as a record with no file.
`importFile` completes the circle: a file whose fingerprint or title matches a
book that has no file attaches to that book instead of creating a second one.

Merges are idempotent. A highlight is considered already present if its id is
known, or if the same text is anchored at the same CFI or page in the same book.

### Updates

The worker is registered in *prompt* mode, so a new build installs and then
waits rather than swapping itself in under a page that is being read.
`src/lib/appUpdates.js` decides when to hand over: it watches the registration
directly (so a version found by the browser or another tab counts too), posts
`SKIP_WAITING`, and reloads on `controllerchange`. Because the reload is driven
from the app rather than from the registration helper, it behaves the same
however the update was discovered.

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
