# Marginalia — EPUB & PDF reader

An offline-first progressive web app for reading EPUB and PDF books, highlighting
as you go, and keeping every highlight from every book in one notebook.

Everything lives on the device. There is no account and nothing is uploaded:
books, highlights and reading positions are stored in IndexedDB, and the app
shell plus both rendering engines are precached so the whole thing works with the
network off.

The one exception is opt-in: if you turn on [sync](#sync), positions and
highlights are copied between your own devices through a Cloudflare Worker you
deploy yourself — encrypted on the device first, so even that server cannot read
them. Book files are never uploaded either way.

## What it does

**Library tab** — import books from the Files app, iCloud Drive, Google Drive, or
anywhere else the system file picker can reach. You can also drag files onto the
window, share a book to the app from the Android share sheet, or open one with
the app from the desktop "Open with" menu. Covers and titles are read from the
book itself (EPUB metadata, or the first page rendered for a PDF), and re-importing
a file you already have is detected by content hash rather than duplicated.

**Reading** — select any text and a colour picker appears right next to it; one tap
saves the highlight. Tap an existing highlight to recolour it, attach a note, copy
it, or remove it — or turn on *Tap a highlight to erase it* in settings and a tap
removes it there and then, with an undo on the message that follows. The contents
drawer lists both the table of contents and the highlights you have made in the
book so far.

**Highlighter mode** — the pen button in the reader bar. Turn it on and drag a
finger across text: the passage highlights as you go, snapped to whole words, in
whichever colour the strip below the bar has selected. No long press, no
selection handles. A drag belongs to the highlighter alone while it is on —
nothing else reads it as a swipe or a scroll — and only the text on the page in
front of you can be caught, never a column waiting off-screen. Taps still turn
the page, and tapping a highlight still edits or erases it. Press *Done*, or
Escape, to go back to normal. It works in both EPUBs and PDFs.

Page turns slide the page across rather than cutting to the next one. Inside a
chapter that slide is a scroll, because a page turn already is one and the
browser is therefore known to paint it; only crossing into a new chapter, where
there is nothing behind the page to scroll away from, travels by transform.
*Animate page turns* in settings turns it off, and it is skipped anyway when the
system asks for reduced motion — which the settings sheet now says out loud
rather than leaving the pages to jump with no explanation.

In an EPUB the drag is heard by a transparent sheet over the book rather than
inside epub.js's iframe, which is where it was heard until an iPhone reported
dozens of failed highlights and not one recorded gesture. The text is still
measured inside the frame; only the listening moved out.

Tapping a highlight erases or edits it across the middle of the page only. The
columns at either edge already belong to the page turn, and the strips above and
below the text are where a hand goes to reach the bars — so a highlight running
through any of those does not answer there, and the tap turns the page or brings
the chrome back as it would anywhere else. The margins around the page answer
the same way rather than swallowing the tap.

Tapping a highlight is answered by a small target of the app's own, laid over
each mark in the top-level document. epub.js detects taps on its own marks by
listening inside the book's iframe and matching coordinates, which is precisely
the place a touch never arrives on iOS — the same fault as the highlighter, and
it needed the same answer. The targets are only as big as the highlights, so
text everywhere else can still be selected.

If a drag ever fails to highlight, *Highlighter diagnostics* at the foot of the
settings sheet has two halves. The self-test runs the whole highlight pipeline
on the page behind it without anyone touching the screen, so it answers even
when no gesture registers at all. Below it are the gestures that did arrive — whether the
touches arrived, how much text could be measured on the page, whether a range
was built and whether it could be anchored to the book. An empty gesture list
after a drag is itself the finding: the touch is not reaching the highlighter.
The self-test also turns a page and watches it, because "the animation is off"
and "the animation ran and was not painted" look identical from the sofa. The
failure message offers a *Why?* button that opens the same screen, and *Copy
all* or *Save file* hands the lot over for a bug report. It exists because the highlighter runs inside
an iframe on a phone, where none of that is visible from the outside.

**Settings** — theme (light, sepia, dark, black), text size, line spacing,
typeface, letter spacing, justification, page margin, and how pages scroll:
page turns or one continuous column for EPUBs, snap-to-page or continuous scroll
for PDFs. PDFs additionally get a zoom control and a fit-width/fit-page choice.
Settings apply live and are remembered between sessions.

**Notes tab** — every highlight from every book, grouped by book and sorted by
reading order, searchable across text and notes. Filter by book, project or
colour, show only annotated highlights, and edit notes in place. Tapping a
highlight jumps to it in the book.

**Cornell sheet** — the Notes tab has three views. The notepad is the list of
everything; the Cornell sheet is one book laid out as a study document. It keeps
the method's three parts: a narrow cue column for the keyword or question that
recalls a passage, a wide notes column holding the passage and what you made of
it, and a summary band closing each chapter and the book. The quotations are
already there — the cues and the summaries are yours to write, and they save as
you leave each field. On a phone the columns stack rather than shrinking, since
a 30/70 split of a phone screen is two unreadable columns. Printing or copying
while it is open gives you the sheet, columns and all, rather than the list.

**Outline** — the same book as a plain outline. The headings are the chapters
the passages were highlighted in, each passage is a bullet beneath its chapter,
and a note nests under the passage it belongs to. A highlight starts wherever
your finger did, which is often mid-sentence, so the first letter of each line
is raised for display — the stored text is left as it was highlighted.

Reading and editing are separate modes: the pen beside the book's title turns
the lines into fields, and until then a tap on a passage opens it in the book
rather than putting a caret in it. Editing a passage changes your copy of it,
not the book. Copying or printing gives you the outline, since Markdown is
already an outline format and it pastes into a document as structure rather
than as a wall of quotations.

**Projects** — folders that cut across books, for when the useful grouping is
the thing you are working on rather than the book it came from. A highlight sits
in one project or in none; file it from the picker on any note, or narrow the
list with the filters and file the whole of it in one move. *Group by project*
turns the notepad inside out, with whatever is still unsorted collected under
*Unfiled* at the bottom. Projects are managed from the **Projects** button:
renaming is in place, and deleting one never deletes what it held — those
highlights come loose and land back in *Unfiled*. Projects sync between devices
and travel in backups, and restoring a backup will put a highlight back into its
project if it is sitting unfiled, so losing a project by accident is
recoverable. Exports follow whichever grouping is on screen, and under a project
heading each quotation names the book it came from.

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

**Sync across devices** — the sync button in the library header. Keeps your
place in each book and your highlights in step between a phone and a tablet.
Everything is encrypted on the device before it leaves, so the server only ever
holds scrambled text; it cannot see your books, your notes, or how far through
you are. Book files are not uploaded — the same file on both devices is matched
by the content hash the app already computes at import, so positions line up on
their own. Set it up on the device that has your reading history, then enter its
code on the other one. It needs the Worker in `worker/` deployed to your own
Cloudflare account; see [worker/README.md](worker/README.md).

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
| `src/components/Notes.jsx` | The compiled notepad, grouping by book or project, filters and export |
| `src/components/ProjectsSheet.jsx` | Making, renaming, reordering and deleting projects |
| `src/components/CornellSheet.jsx` | One book as a Cornell study document: cue column, notes column, summary bands |
| `src/components/OutlineSheet.jsx` | One book as a continuous outline: chapter headings, bulleted passages, nested notes |
| `src/components/Reader.jsx` | Reader chrome: title bar, progress, settings sheet, contents drawer |
| `src/components/EpubView.jsx` | epub.js rendition, CFI-anchored highlights, typography and flow |
| `src/components/PdfView.jsx` / `PdfPage.jsx` | pdf.js canvas + selectable text layer, lazy page rendering, rect-anchored highlights |
| `src/lib/db.js` | IndexedDB stores: `books`, `files`, `highlights`, `projects`, `summaries`, `prefs`, `tombstones` |
| `src/lib/importBook.js` | Format detection, metadata and cover extraction, de-duplication, adopting restored books |
| `src/lib/pdfRects.js` | Turns a DOM selection into page-relative highlight boxes |
| `src/lib/dragHighlight.js` | Highlighter mode: caret hit-testing, word snapping and the drag gesture, shared by both views |
| `src/lib/highlighterTrace.js` / `components/DiagnosticsSheet.jsx` | What each highlighter gesture did, for diagnosing a device you cannot reach |
| `src/lib/backup.js` | Building, parsing and merging notes backups |
| `src/lib/sync.js` / `syncCrypto.js` | Cross-device sync: key derivation, encryption, and the push/pull round |
| `worker/` | The Cloudflare Worker and D1 schema behind sync |
| `src/lib/printNotes.js` / `components/NotesPrintSheet.jsx` | The PDF export: a print-only rendition of the notepad |
| `src/lib/appUpdates.js` | Service worker lifecycle: version checks, the update state, and when a new build is applied |
| `src/components/AboutSheet.jsx` / `UpdateBanner.jsx` | Version and update UI |
| `src/sw.js` | Precaching, offline navigation, the skip-waiting handler, and the Web Share Target |
| `.github/workflows/deploy.yml` | Builds and publishes the site to GitHub Pages |

### Highlighter mode

Touch text selection is the weak point of highlighting in a reader. On iOS it
means a long press, a magnifier and two drag handles, and inside epub.js's
sandboxed iframe the selection events that go with it are unreliable — which is
why highlighting EPUBs on an iPad did not work.

`dragHighlight.js` does not use the native selection at all. It hit-tests a caret
position under the finger on the way down and again on every move, builds the
Range itself, and grows it out to whole words. A press that never moves is
reported separately and still turns the page.

Two details exist specifically because of WebKit, and both were found the hard
way on an actual iPhone:

- **The content is not made unselectable.** The obvious way to stop iOS showing
  its magnifier and selection handles is `user-select: none`, but WebKit ties
  caret hit-testing to selectability: `caretRangeFromPoint` returns null inside
  unselectable text, so the whole gesture silently does nothing. Chromium does
  not care, which is exactly why this was easy to get wrong. iOS's selection UI
  is held off by preventing the default on the touch instead.
- **The gesture is tracked with Touch events, not Pointer events**, which have a
  patchy history inside iframes on iOS.

Inside epub.js's iframe on WebKit, hit-testing does not work at all — neither
`caretRangeFromPoint` nor `elementFromPoint` returns anything usable. So the
fallback uses no hit-testing API whatsoever. On touch-down it measures every
visible word with `Range.getBoundingClientRect` and builds an index of where each
one sits; from then on, finding the text under the finger is a search over those
rectangles. Nothing can scroll while the highlighter holds the gesture, so the
measurements stay true for the life of the drag, and only text within the
viewport is measured — the page in front of you, not the chapter.

Word granularity is not a compromise here: the range is snapped to word
boundaries regardless, so the outcome is identical to a caret hit-test.

`webkit-sim-test` covers this by breaking the APIs inside the book — first making
the caret APIs return null, then removing them, then killing `elementFromPoint`
too — and checking that a real finger drag still produces a highlight with the
right text.

The EPUB view converts the finished Range to a CFI with `contents.cfiFromRange`,
and the PDF view converts it to page-relative rectangles — so a dragged highlight
is stored exactly like a selected one.

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

### Sync

`worker/` is a Cloudflare Worker over D1 that stores encrypted records for an
account id. It is deliberately incapable of reading them: the device derives
both an account id and an AES-GCM key from one sync code with HKDF, sends only
the id, and encrypts every payload before it leaves. There are no accounts and
no secrets in the Worker — the sync code is the whole credential, so it is 125
bits of randomness.

The part that makes it work is what records are keyed by. A book's local id is a
UUID minted at import, so the same EPUB has different ids on a phone and a
tablet; keying by it would sync nothing useful. Records are keyed by the book's
**content fingerprint** instead, which both devices compute identically. A
highlight also carries its book's title and author, so a device that has not
imported that book yet still keeps the note — as a *notes only* entry that a
later import adopts, exactly like a restored backup.

Conflicts are last-write-wins on the device clock, enforced server-side, so a
device that was offline for a week cannot overwrite something newer when it
reconnects. Pulls use a per-account sequence number rather than a clock, so no
record is missed or repeated. Deletions travel as tombstones — without them a
delete on one device is simply undone by the next sync from the other.

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
