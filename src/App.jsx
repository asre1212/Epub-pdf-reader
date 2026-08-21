import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AboutSheet from './components/AboutSheet.jsx';
import Library from './components/Library.jsx';
import Notes from './components/Notes.jsx';
import Reader from './components/Reader.jsx';
import Toasts from './components/Toasts.jsx';
import SyncSheet from './components/SyncSheet.jsx';
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
  restoreHighlight as dbRestoreHighlight,
  listProjects,
  putProject,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject,
  assignProject as dbAssignProject,
  listSummaries,
  saveSummary as dbSaveSummary,
  newId,
  updateBook,
  updateHighlight as dbUpdateHighlight,
} from './lib/db.js';
import { restoreBackup } from './lib/backup.js';
import { getSyncConfig, syncNow } from './lib/sync.js';
import { importFiles } from './lib/importBook.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './lib/settings.js';
import { drainSharedFiles } from './lib/shareInbox.js';
import NameDialog from './components/NameDialog.jsx';

export default function App() {
  const [tab, setTab] = useState('library');
  const [books, setBooks] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [reading, setReading] = useState(null); // { book, focusHighlightId }
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [projects, setProjects] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [namingProject, setNamingProject] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showAbout, setShowAbout] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [usage, setUsage] = useState(null);
  const toastId = useRef(0);
  const syncTimer = useRef(null);
  const lastSyncAttempt = useRef(0);
  const update = useUpdateState();

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  /**
   * `action` is an optional { label, onAct } shown as a button on the toast —
   * how an undo is offered for something that happened without asking.
   */
  const notify = useCallback(
    (message, tone = 'info', action = null) => {
      const id = ++toastId.current;
      setToasts((list) => [...list, { id, message, tone, action }]);
      setTimeout(() => dismissToast(id), action ? 7000 : 4200);
    },
    [dismissToast],
  );

  /* ------------------------------------------------------------- bootstrap */

  const refreshBooks = useCallback(async () => {
    setBooks(await listBooks());
  }, []);

  const refreshHighlights = useCallback(async () => {
    setHighlights(await listHighlights());
  }, []);

  const refreshProjects = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  const refreshSummaries = useCallback(async () => {
    setSummaries(await listSummaries());
  }, []);

  useEffect(() => {
    (async () => {
      const [stored] = await Promise.all([
        loadSettings(),
        refreshBooks(),
        refreshHighlights(),
        refreshProjects(),
        refreshSummaries(),
      ]);
      setSettings(stored);
      setSettingsReady(true);
    })().catch((err) => {
      console.error(err);
      notify('Could not open local storage. Private browsing may be blocking it.', 'error');
      setSettingsReady(true);
    });
  }, [refreshBooks, refreshHighlights, refreshProjects, refreshSummaries, notify]);

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
        const { added, duplicates, adopted, errors } = await importFiles(files);
        await refreshBooks();
        if (added.length) {
          notify(
            added.length === 1 ? `Added “${added[0].title}”` : `Added ${added.length} books`,
            'success',
          );
        }
        if (adopted.length) {
          // These books came back from a notes backup without their files.
          notify(
            adopted.length === 1
              ? `Reunited “${adopted[0].title}” with its highlights`
              : `Reunited ${adopted.length} books with their highlights`,
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
    // Stamp position changes so sync can tell which device moved last.
    const moved = 'location' in patch || 'progress' in patch;
    const next = moved ? { ...patch, positionAt: Date.now() } : patch;
    setBooks((list) => list?.map((b) => (b.id === id ? { ...b, ...next } : b)) ?? list);
    setReading((current) =>
      current && current.book.id === id ? { ...current, book: { ...current.book, ...next } } : current,
    );
    await updateBook(id, next);
  }, []);

  /* ------------------------------------------------------------------ sync */

  const refreshAll = useCallback(
    () => Promise.all([refreshBooks(), refreshHighlights()]),
    [refreshBooks, refreshHighlights],
  );

  const runSync = useCallback(
    async ({ force = false } = {}) => {
      const config = await getSyncConfig();
      if (!config.enabled) return;
      lastSyncAttempt.current = Date.now();
      const result = await syncNow({ force });
      if (result?.applied) await refreshAll();
    },
    [refreshAll],
  );

  /** Local edits settle for a moment before being pushed, so a burst is one round. */
  const scheduleSync = useCallback(() => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => runSync(), 4000);
  }, [runSync]);

  useEffect(() => {
    if (!settingsReady) return undefined;
    runSync();

    const onVisible = () => {
      // Coming back to the app is the moment the other device's position matters.
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastSyncAttempt.current < 30000) return;
      runSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', () => runSync({ force: true }));
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(syncTimer.current);
    };
  }, [settingsReady, runSync]);

  /* ------------------------------------------------------- highlight state */

  const addHighlight = useCallback(
    async (highlight) => {
      const saved = await putHighlight(highlight);
      setHighlights((list) => [...list, saved]);
      scheduleSync();
      return saved;
    },
    [scheduleSync],
  );

  const undeleteHighlight = useCallback(
    async (highlight) => {
      const saved = await dbRestoreHighlight(highlight);
      setHighlights((list) => [...list.filter((h) => h.id !== saved.id), saved]);
      scheduleSync();
      return saved;
    },
    [scheduleSync],
  );

  const editHighlight = useCallback(
    async (id, patch) => {
      const next = await dbUpdateHighlight(id, patch);
      if (next) setHighlights((list) => list.map((h) => (h.id === id ? next : h)));
      scheduleSync();
      return next;
    },
    [scheduleSync],
  );

  const removeHighlight = useCallback(
    async (id) => {
      await dbDeleteHighlight(id);
      setHighlights((list) => list.filter((h) => h.id !== id));
      scheduleSync();
    },
    [scheduleSync],
  );

  /* -------------------------------------------------------------- projects */

  /**
   * Naming happens in a dialog rather than a prompt, and the promise is what the
   * callers need: every place that offers "New project…" wants to file something
   * into it the moment it exists.
   */
  const createProject = useCallback(
    () =>
      new Promise((resolve) => {
        setNamingProject({
          resolve: async (name) => {
            if (!name) {
              resolve(null);
              return;
            }
            const made = await putProject({
              id: newId(),
              name,
              order: Date.now(),
              createdAt: Date.now(),
            });
            await refreshProjects();
            scheduleSync();
            notify(`Project “${made.name}” created`, 'success');
            resolve(made);
          },
        });
      }),
    [notify, refreshProjects, scheduleSync],
  );

  const renameProject = useCallback(
    async (id, name) => {
      await dbUpdateProject(id, { name });
      await refreshProjects();
      scheduleSync();
    },
    [refreshProjects, scheduleSync],
  );

  const removeProject = useCallback(
    async (id) => {
      const project = projects.find((p) => p.id === id);
      const freed = await dbDeleteProject(id);
      await Promise.all([refreshProjects(), refreshHighlights()]);
      scheduleSync();
      notify(
        freed.length
          ? `“${project?.name || 'Project'}” deleted · ${freed.length} highlight${
              freed.length === 1 ? '' : 's'
            } unfiled`
          : `“${project?.name || 'Project'}” deleted`,
      );
    },
    [projects, notify, refreshProjects, refreshHighlights, scheduleSync],
  );

  /** Manual order, stored as a rank so two devices agree on the list. */
  const reorderProjects = useCallback(
    async (orderedIds) => {
      await Promise.all(orderedIds.map((id, index) => dbUpdateProject(id, { order: index })));
      await refreshProjects();
      scheduleSync();
    },
    [refreshProjects, scheduleSync],
  );

  const assignProject = useCallback(
    async (highlightIds, projectId) => {
      const changed = await dbAssignProject(highlightIds, projectId);
      if (changed.length) {
        await refreshHighlights();
        scheduleSync();
      }
      return changed.length;
    },
    [refreshHighlights, scheduleSync],
  );

  /**
   * The Cornell summary bands. Saved on blur rather than on every keystroke:
   * this is prose, and a write per character would be both wasteful and a poor
   * unit for sync to resolve.
   */
  const saveSummary = useCallback(
    async (bookId, patch) => {
      const saved = await dbSaveSummary(bookId, patch);
      setSummaries((list) => [...list.filter((r) => r.id !== saved.id), saved]);
      scheduleSync();
      return saved;
    },
    [scheduleSync],
  );

  const handleRestoreBackup = useCallback(
    async (file) => {
      const report = await restoreBackup(file);
      await Promise.all([
        refreshBooks(),
        refreshHighlights(),
        refreshProjects(),
        refreshSummaries(),
      ]);
      return report;
    },
    [refreshBooks, refreshHighlights, refreshProjects, refreshSummaries],
  );

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
                onOpenSync={() => setShowSync(true)}
                updateReady={update.needRefresh}
              />
            ) : (
              <Notes
                books={books || []}
                highlights={highlights}
                projects={projects}
                summaries={summaries}
                onOpenHighlight={(book, highlight) => openBook(book, highlight.id)}
                onEditHighlight={editHighlight}
                onDeleteHighlight={removeHighlight}
                onAssignProject={assignProject}
                onCreateProject={createProject}
                onRenameProject={renameProject}
                onDeleteProject={removeProject}
                onReorderProjects={reorderProjects}
                onSaveSummary={saveSummary}
                onRestoreBackup={handleRestoreBackup}
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
          onUndeleteHighlight={undeleteHighlight}
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

      {showSync && (
        <SyncSheet
          notify={notify}
          onSynced={refreshAll}
          onClose={() => setShowSync(false)}
        />
      )}

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone-card">Drop EPUB or PDF files to add them</div>
        </div>
      )}

      {namingProject && (
        <NameDialog
          title="New project"
          label="What is this collection of notes for?"
          placeholder="Thesis, book club, Chapter 3…"
          confirmLabel="Create"
          onSubmit={(name) => {
            const { resolve } = namingProject;
            setNamingProject(null);
            resolve(name);
          }}
          onClose={() => {
            const { resolve } = namingProject;
            setNamingProject(null);
            resolve(null);
          }}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
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
