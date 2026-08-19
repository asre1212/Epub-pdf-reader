import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SettingsSheet from './SettingsSheet.jsx';
import DiagnosticsSheet from './DiagnosticsSheet.jsx';
import TocDrawer from './TocDrawer.jsx';
import { HIGHLIGHT_COLORS, colorHex } from '../lib/highlightColors.js';
import { getBookFile, newId } from '../lib/db.js';
import { THEMES } from '../lib/settings.js';

const EpubView = lazy(() => import('./EpubView.jsx'));
const PdfView = lazy(() => import('./PdfView.jsx'));

export default function Reader({
  book,
  focusHighlightId,
  highlights,
  settings,
  onChangeSettings,
  onClose,
  onAddHighlight,
  onEditHighlight,
  onDeleteHighlight,
  onUndeleteHighlight,
  onProgress,
  notify,
}) {
  const viewRef = useRef(null);
  const [blob, setBlob] = useState(null);
  const [missing, setMissing] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  // A per-session mode rather than a saved setting: it suppresses scrolling and
  // text selection, so it should not be a surprise the next time a book opens.
  const [highlighterOn, setHighlighterOn] = useState(false);
  const [meta, setMeta] = useState({
    toc: [],
    chapter: '',
    progress: book.progress || 0,
    page: null,
    numPages: book.pageCount || null,
  });

  const palette = THEMES[settings.theme] || THEMES.sepia;

  useEffect(() => {
    let cancelled = false;
    getBookFile(book.id).then((file) => {
      if (cancelled) return;
      if (file) setBlob(file);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  const handleMeta = useCallback((patch) => {
    setMeta((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleCreate = useCallback(
    (partial) => onAddHighlight({ id: newId(), note: '', ...partial }),
    [onAddHighlight],
  );

  const toggleChrome = useCallback(() => setChrome((visible) => !visible), []);

  // Escape backs out one layer at a time.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (showDiagnostics) setShowDiagnostics(false);
      else if (showSettings) setShowSettings(false);
      else if (showToc) setShowToc(false);
      else if (highlighterOn) setHighlighterOn(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDiagnostics, showSettings, showToc, highlighterOn, onClose]);

  // Optional wake lock, released whenever the reader is hidden or closed.
  useEffect(() => {
    if (!settings.keepAwake || !navigator.wakeLock) return undefined;
    let sentinel = null;
    let released = false;
    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* denied or unsupported */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !released) request();
    };
    request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release?.().catch(() => {});
    };
  }, [settings.keepAwake]);

  const percent = Math.round((meta.progress || 0) * 100);

  const subtitle = useMemo(() => {
    if (book.format === 'pdf') {
      return meta.page && meta.numPages ? `Page ${meta.page} of ${meta.numPages}` : book.author || '';
    }
    return meta.chapter || book.author || '';
  }, [book.author, book.format, meta.chapter, meta.numPages, meta.page]);

  const ViewComponent = book.format === 'pdf' ? PdfView : EpubView;

  return (
    <div
      className={[
        'reader',
        `theme-${settings.theme}`,
        chrome ? '' : 'is-immersive',
        highlighterOn ? 'is-highlighter-on' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        '--paper': palette.bg,
        '--ink': palette.fg,
        '--ink-muted': palette.muted,
        '--highlighter': colorHex(settings.defaultColor),
      }}
    >
      <header className="reader-bar reader-top">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Back to library">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="reader-title">
          <strong>{book.title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>

        <button
          type="button"
          className={highlighterOn ? 'icon-btn icon-btn-on' : 'icon-btn'}
          onClick={() => setHighlighterOn((on) => !on)}
          aria-pressed={highlighterOn}
          aria-label={highlighterOn ? 'Turn the highlighter off' : 'Turn the highlighter on'}
          title="Highlighter"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M4 19.5h5l1.3-1.3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M9.4 17.2 6.8 14.6 14.9 6.5a1.9 1.9 0 0 1 2.6 0l0 0a1.9 1.9 0 0 1 0 2.6z"
              fill={highlighterOn ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowToc(true)}
          aria-label="Contents"
          disabled={!meta.toc?.length}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M5 6.5h14M5 12h14M5 17.5h9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowSettings(true)}
          aria-label="Reading settings"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M4 8h10M18 8h2M4 16h4M12 16h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <circle cx="16" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
            <circle cx="10" cy="16" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
          </svg>
        </button>
      </header>

      {highlighterOn && (
        <div className="highlightbar">
          <span className="highlightbar-hint">
            {settings.tapToErase
              ? 'Drag across text to highlight, tap a highlight to erase'
              : 'Drag across text to highlight'}
          </span>
          <div className="swatch-row" role="group" aria-label="Highlighter colour">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={settings.defaultColor === color.id ? 'swatch is-on' : 'swatch'}
                style={{ '--swatch': color.hex }}
                onClick={() => onChangeSettings({ defaultColor: color.id })}
                aria-label={color.label}
                aria-pressed={settings.defaultColor === color.id}
              />
            ))}
          </div>
          <button type="button" className="btn btn-small" onClick={() => setHighlighterOn(false)}>
            Done
          </button>
        </div>
      )}

      <div className="reader-stage">
        {missing && (
          <div className="view-status">
            The file for this book is missing. Import it again from the library.
          </div>
        )}

        {blob && (
          <Suspense fallback={<div className="view-status">Opening book…</div>}>
            <ViewComponent
              ref={viewRef}
              blob={blob}
              book={book}
              settings={settings}
              highlights={highlights}
              focusHighlightId={focusHighlightId}
              onCreateHighlight={handleCreate}
              onUpdateHighlight={onEditHighlight}
              onDeleteHighlight={onDeleteHighlight}
              onUndeleteHighlight={onUndeleteHighlight}
              onProgress={onProgress}
              onMeta={handleMeta}
              onToggleChrome={toggleChrome}
              onShowDiagnostics={() => setShowDiagnostics(true)}
              highlighterOn={highlighterOn}
              notify={notify}
            />
          </Suspense>
        )}
      </div>

      <footer className="reader-bar reader-bottom">
        <button
          type="button"
          className="icon-btn"
          onClick={() => viewRef.current?.prev()}
          aria-label="Previous page"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="reader-progress">
          <div className="reader-progress-track">
            <div className="reader-progress-fill" style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <span>
            {percent}%
            {highlights.length > 0 && ` · ${highlights.length} highlight${highlights.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <button
          type="button"
          className="icon-btn"
          onClick={() => viewRef.current?.next()}
          aria-label="Next page"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>

      {showSettings && (
        <SettingsSheet
          format={book.format}
          settings={settings}
          onChange={onChangeSettings}
          onDiagnostics={() => {
            setShowSettings(false);
            setShowDiagnostics(true);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showDiagnostics && (
        <DiagnosticsSheet
          format={book.format}
          onSelfTest={() => viewRef.current?.selfTest?.() || null}
          notify={notify}
          onClose={() => setShowDiagnostics(false)}
        />
      )}

      {showToc && (
        <TocDrawer
          toc={meta.toc}
          highlights={highlights}
          format={book.format}
          onGo={(target) => {
            setShowToc(false);
            viewRef.current?.goTo(target);
          }}
          onGoHighlight={(id) => {
            setShowToc(false);
            viewRef.current?.goToHighlight(id);
          }}
          onClose={() => setShowToc(false)}
        />
      )}
    </div>
  );
}
