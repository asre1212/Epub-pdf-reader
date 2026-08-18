import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AboutSheet from './components/AboutSheet.jsx';
import Library from './components/Library.jsx';
import Notes from './components/Notes.jsx';
import Reader from './components/Reader.jsx';
import Toasts from './components/Toasts.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import {
  applyUpdate,
  checkForUpdate,
  getUpdateState,
  setAutoUpdate,
} from './lib/appUpdates.js';
import { useUpdateState } from './lib/useUpdateState.js';
import {
  deleteBook as dbDeleteBook,
  deleteHighlight as dbDeleteHighlight,
  estimateUsage,
  listBooks,
  listHighlights,
  putHighlight,
  updateBook,
  updateHighlight as dbUpdateHighlight,
} from './lib/db.js';
import { importFiles } from './lib/importBook.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './lib/settings.js';
import { drainSharedFiles } from './lib/shareInbox.js';

export default function App() {
  const [tab, setTab] = useState('library');
  const [books, setBooks] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [reading, setReading] = useState(null); // { book, focusHighlightId }
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showAbout, setShowAbout] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [usage, setUsage] = useState(null);
  const toastId = useRef(0);
  const update = useUpdateState();

  const notify = useCallback((message, tone = 'info') => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  /* ------------------------------------------------------------- bootstrap */

  const refreshBooks = useCallback(async () => {
    setBooks(await listBooks());
  }, []);

  const refreshHighlights = useCallback(async () => {
    setHighlights(await listHighlights());
  }, []);

  useEffect(() => {
    (async () => {
      const [stored] = await Promise.all([loadSettings(), refreshBooks(), refreshHighlights()]);
      setSettings(stored);
      setSettingsReady(true);
    })().catch((err) => {
      console.error(err);
      notify('Could not open local storage. Private browsing may be blocking it.', 'error');
      setSettingsReady(true);
    });
  }, [refreshBooks, refreshHighlights, notify]);

  /* --------------------------------------------------------------- updates */

  // Auto-update waits until nobody is mid-page: a reload during reading is
  // jarring even though the position is saved. Otherwise the banner offers it.
  useEffect(() => {
    if (!update.needRefresh || !update.autoUpdate || update.applying || reading) return undefined;
    notify('Installing the latest version…');
    const timer = setTimeout(applyUpdate, 1200);
    return () => clearTimeout(timer);
  }, [update.needRefresh, update.autoUpdate, update.applying, reading, notify]);

  useEffect(() => {
    if (update.needRefresh) setUpdateDismissed(false);
  }, [update.needRefresh]);

  useEffect(() => {
    if (update.firstInstall) notify('Ready to read offline', 'success');
  }, [update.firstInstall, notify]);

  const runCheck = useCallback(async () => {
    const found = await checkForUpdate();
    if (found) return;
    // Read straight from the store: this callback's snapshot predates the check.
    const { error } = getUpdateState();
    notify(error || 'You are running the latest version', error ? 'error' : 'success');
  }, [notify]);

  useEffect(() => {
    if (showAbout) estimateUsage().then(setUsage);
  }, [showAbout, books]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      saveSettings(next).catch(() => {});
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- import */

  const handleFiles = useCallback(
    async (fileList) => {
      const files = [...(fileList || [])];
      if (!files.length) return;
      setImporting(true);
      try {
        const { added, duplicates, errors } = await importFiles(files);
        await refreshBooks();
        if (added.length) {
          notify(
            added.length === 1 ? `Added “${added[0].title}”` : `Added ${added.length} books`,
            'success',
          );
        }
        if (duplicates.length) {
          notify(
            duplicates.length === 1
              ? `“${duplicates[0].title}” is already in your library`
              : `${duplicates.length} books were already in your library`,
          );
        }
        for (const error of errors) notify(`${error.name}: ${error.message}`, 'error');
        if (added.length) setTab('library');
      } finally {
        setImporting(false);
      }
    },
    [notify, refreshBooks],
  );

  // Books arriving from the OS: share sheet (Android) and "Open with" (desktop).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const shared = await drainSharedFiles();
      if (!cancelled && shared.length) await handleFiles(shared);
      if (new URL(location.href).searchParams.has('share-target')) {
        history.replaceState(null, '', location.pathname + location.hash);
      }
    })();

    if ('launchQueue' in window && typeof LaunchParams !== 'undefined') {
      window.launchQueue.setConsumer(async (params) => {
        if (!params?.files?.length) return;
        const files = await Promise.all(params.files.map((handle) => handle.getFile()));
        await handleFiles(files);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [handleFiles]);

  // Drag a book anywhere onto the window to import it.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (e) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  /* ------------------------------------------------------------ book state */

  const openBook = useCallback(async (book, focusHighlightId = null) => {
    const patch = { lastOpenedAt: Date.now() };
    setBooks((list) => list?.map((b) => (b.id === book.id ? { ...b, ...patch } : b)) ?? list);
    await updateBook(book.id, patch);
    setReading({ book: { ...book, ...patch }, focusHighlightId });
  }, []);

  const closeBook = useCallback(() => setReading(null), []);

  const removeBook = useCallback(
    async (book) => {
      await dbDeleteBook(book.id);
      setBooks((list) => list?.filter((b) => b.id !== book.id) ?? list);
      setHighlights((list) => list.filter((h) => h.bookId !== book.id));
      notify(`Removed “${book.title}”`);
    },
    [notify],
  );

  const patchBook = useCallback(async (id, patch) => {
    setBooks((list) => list?.map((b) => (b.id === id ? { ...b, ...patch } : b)) ?? list);
    setReading((current) =>
      current && current.book.id === id ? { ...current, book: { ...current.book, ...patch } } : current,
    );
    await updateBook(id, patch);
  }, []);

  /* ------------------------------------------------------- highlight state */

  const addHighlight = useCallback(async (highlight) => {
    await putHighlight(highlight);
    setHighlights((list) => [...list, highlight]);
    return highlight;
  }, []);

  const editHighlight = useCallback(async (id, patch) => {
    const next = await dbUpdateHighlight(id, patch);
    if (next) setHighlights((list) => list.map((h) => (h.id === id ? next : h)));
    return next;
  }, []);

  const removeHighlight = useCallback(async (id) => {
    await dbDeleteHighlight(id);
    setHighlights((list) => list.filter((h) => h.id !== id));
  }, []);

  const highlightCounts = useMemo(() => {
    const counts = new Map();
    for (const h of highlights) counts.set(h.bookId, (counts.get(h.bookId) || 0) + 1);
    return counts;
  }, [highlights]);

  const readingHighlights = useMemo(
    () => (reading ? highlights.filter((h) => h.bookId === reading.book.id) : []),
    [highlights, reading],
  );

  /* -------------------------------------------------------------- rendering */

  if (!settingsReady) {
    return (
      <div className="boot">
        <div className="boot-mark" aria-hidden="true" />
        <p>Opening your library…</p>
      </div>
    );
  }

  return (
    <div className="app" data-tab={tab}>
      {!reading && (
        <>
          <main className="app-body">
            {tab === 'library' ? (
              <Library
                books={books}
                highlightCounts={highlightCounts}
                importing={importing}
                onImport={handleFiles}
                onOpen={openBook}
                onDelete={removeBook}
                onRename={(book, title) => patchBook(book.id, { title })}
                onOpenAbout={() => setShowAbout(true)}
                updateReady={update.needRefresh}
              />
            ) : (
              <Notes
                books={books || []}
                highlights={highlights}
                onOpenHighlight={(book, highlight) => openBook(book, highlight.id)}
                onEditHighlight={editHighlight}
                onDeleteHighlight={removeHighlight}
                notify={notify}
              />
            )}
          </main>

          {update.needRefresh && !updateDismissed && !update.autoUpdate && (
            <UpdateBanner
              applying={update.applying}
              onUpdate={applyUpdate}
              onDismiss={() => setUpdateDismissed(true)}
            />
          )}

          <nav className="tabbar" aria-label="Main">
            <button
              type="button"
              className={tab === 'library' ? 'tab is-active' : 'tab'}
              aria-current={tab === 'library' ? 'page' : undefined}
              onClick={() => setTab('library')}
            >
              <LibraryIcon />
              <span>Library</span>
            </button>
            <button
              type="button"
              className={tab === 'notes' ? 'tab is-active' : 'tab'}
              aria-current={tab === 'notes' ? 'page' : undefined}
              onClick={() => setTab('notes')}
            >
              <NotesIcon />
              <span>Notes</span>
              {highlights.length > 0 && <em className="tab-count">{highlights.length}</em>}
            </button>
          </nav>
        </>
      )}

      {reading && (
        <Reader
          key={reading.book.id}
          book={reading.book}
          focusHighlightId={reading.focusHighlightId}
          highlights={readingHighlights}
          settings={settings}
          onChangeSettings={updateSettings}
          onClose={closeBook}
          onAddHighlight={addHighlight}
          onEditHighlight={editHighlight}
          onDeleteHighlight={removeHighlight}
          onProgress={patchBook}
          notify={notify}
        />
      )}

      {showAbout && (
        <AboutSheet
          update={update}
          usage={usage}
          onCheck={runCheck}
          onUpdate={applyUpdate}
          onToggleAuto={setAutoUpdate}
          onClose={() => setShowAbout(false)}
        />
      )}

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone-card">Drop EPUB or PDF files to add them</div>
        </div>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.2H5.5A1.5 1.5 0 0 1 4 16.3zm16 0A1.5 1.5 0 0 0 18.5 4H15a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.2h3.9a1.5 1.5 0 0 0 1.5-1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M6 3.75h9.4L19 7.3v13a.95.95 0 0 1-.95.95H6a.95.95 0 0 1-.95-.95V4.7A.95.95 0 0 1 6 3.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14.8 3.9v3.6h3.7M8.2 12h7.6M8.2 15.6h7.6M8.2 8.4h3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
