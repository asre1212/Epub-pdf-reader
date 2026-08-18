import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub, { EpubCFI } from 'epubjs';
import SelectionMenu from './SelectionMenu.jsx';
import NoteDialog from './NoteDialog.jsx';
import { colorHex } from '../lib/highlightColors.js';
import { HIGHLIGHTER_CSS, attachDragHighlighter } from '../lib/dragHighlight.js';
import { FONT_STACKS, THEMES } from '../lib/settings.js';
import { copyToClipboard } from '../lib/exportNotes.js';

const HIGHLIGHT_CLASS = 'marginalia-hl';
const SWIPE_MIN = 45;
const STYLE_ID = 'marginalia-highlighter-mode';
// The page-turn animation swaps content at its midpoint, while it is faded out.
const TURN_MS = 260;
const TURN_SWAP_MS = 115;

function flatten(items, depth = 0, out = []) {
  for (const item of items || []) {
    out.push({ id: item.id || item.href, href: item.href, label: item.label, depth });
    if (item.subitems?.length) flatten(item.subitems, depth + 1, out);
  }
  return out;
}

/** epub.js and TOC hrefs disagree about paths often enough to need a fallback. */
function hrefKey(href = '') {
  return href.split('#')[0].split('/').pop().toLowerCase();
}

function themeRules(settings) {
  const palette = THEMES[settings.theme] || THEMES.sepia;
  const stack = FONT_STACKS[settings.fontFamily];

  const body = {
    color: `${palette.fg} !important`,
    background: 'transparent !important',
    'line-height': `${settings.lineHeight} !important`,
    'text-align': settings.justify ? 'justify' : 'start',
    'letter-spacing': `${settings.letterSpacing}px`,
    '-webkit-hyphens': settings.justify ? 'auto' : 'manual',
    hyphens: settings.justify ? 'auto' : 'manual',
    'overflow-wrap': 'break-word',
    padding: '0 !important',
    margin: '0 !important',
  };
  const inherited = {
    'line-height': `${settings.lineHeight} !important`,
    color: `${palette.fg} !important`,
  };
  if (stack) {
    body['font-family'] = `${stack} !important`;
    inherited['font-family'] = `${stack} !important`;
  }

  return {
    body,
    'p, li, dd, dt, blockquote, div, td, th, span': inherited,
    'h1, h2, h3, h4, h5, h6': {
      color: `${palette.fg} !important`,
      'line-height': '1.25 !important',
    },
    a: { color: `${palette.fg} !important`, 'text-decoration-color': palette.muted },
    'img, svg, video': { 'max-width': '100% !important', height: 'auto !important' },
    'pre, code': { 'white-space': 'pre-wrap', 'overflow-wrap': 'break-word' },
    '::selection': { background: 'rgba(120, 160, 255, 0.35)' },
    [`.${HIGHLIGHT_CLASS}`]: { cursor: 'pointer' },
  };
}

/** Maps a Range inside an epub.js iframe to viewport coordinates. */
function viewportRect(range, contents) {
  const inner = range.getBoundingClientRect();
  const frame = contents?.document?.defaultView?.frameElement;
  if (!frame) return { left: inner.left, top: inner.top, width: inner.width, height: inner.height };
  const outer = frame.getBoundingClientRect();
  return {
    left: outer.left + inner.left,
    top: outer.top + inner.top,
    width: inner.width,
    height: inner.height,
  };
}

const EpubView = forwardRef(function EpubView(
  {
    blob,
    book,
    settings,
    highlights,
    focusHighlightId,
    onCreateHighlight,
    onUpdateHighlight,
    onDeleteHighlight,
    onProgress,
    onMeta,
    onToggleChrome,
    highlighterOn,
    notify,
  },
  ref,
) {
  const hostRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const tocRef = useRef([]);
  const locationRef = useRef(book.location || null);
  const highlightsRef = useRef(highlights);
  const drawnRef = useRef(new Map()); // highlight id -> painted cfi
  const pendingFocusRef = useRef(focusHighlightId);
  const markClickRef = useRef(0);
  const menuOpenRef = useRef(false);
  const settingsRef = useRef(settings);
  const touchRef = useRef(null);
  const highlighterRef = useRef(highlighterOn);
  // contents.document -> detach function for its drag listener
  const dragDetachRef = useRef(new Map());
  const turningRef = useRef(false);
  const [turn, setTurn] = useState(null);
  const [preview, setPreview] = useState(null);

  const [status, setStatus] = useState('loading');
  const [menu, setMenu] = useState(null);
  const [noteFor, setNoteFor] = useState(null);

  highlightsRef.current = highlights;
  settingsRef.current = settings;
  menuOpenRef.current = !!menu;
  highlighterRef.current = highlighterOn;

  const closeMenu = useCallback(() => setMenu(null), []);

  /* ------------------------------------------------------------- highlights */

  const paintHighlights = useCallback((force = false) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const drawn = drawnRef.current;
    const wanted = new Map(highlightsRef.current.map((h) => [h.id, h]));

    for (const [id, cfi] of [...drawn]) {
      const next = wanted.get(id);
      if (force || !next || next.cfi !== cfi) {
        try {
          rendition.annotations.remove(cfi, 'highlight');
        } catch {
          /* the view holding it may already be gone */
        }
        drawn.delete(id);
      }
    }

    for (const highlight of wanted.values()) {
      if (drawn.has(highlight.id)) continue;
      try {
        rendition.annotations.highlight(
          highlight.cfi,
          { id: highlight.id },
          (event) => {
            markClickRef.current = Date.now();
            const target = event?.currentTarget || event?.target;
            const box = target?.getBoundingClientRect?.();
            setMenu({
              mode: 'edit',
              id: highlight.id,
              rect: box
                ? { left: box.left, top: box.top, width: box.width, height: box.height }
                : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 },
            });
          },
          HIGHLIGHT_CLASS,
          highlightStyle(highlight.color, settingsRef.current.theme),
        );
        drawn.set(highlight.id, highlight.cfi);
      } catch {
        // A CFI outside the rendered section simply is not painted yet; it will
        // be drawn when that section scrolls into view.
      }
    }
  }, []);

  /* ------------------------------------------------------------- reporting */

  const chapterFor = useCallback((href) => {
    if (!href) return '';
    const direct = bookRef.current?.navigation?.get?.(href);
    if (direct?.label) return direct.label.trim();
    const key = hrefKey(href);
    const match = tocRef.current.find((item) => hrefKey(item.href) === key);
    return match?.label?.trim() || '';
  }, []);

  const reportLocation = useCallback(
    (location) => {
      if (!location?.start) return;
      const epubBook = bookRef.current;
      const cfi = location.start.cfi;
      locationRef.current = cfi;

      let progress = 0;
      try {
        if (epubBook?.locations?.length()) {
          progress = epubBook.locations.percentageFromCfi(cfi) || 0;
        } else if (epubBook?.spine?.length) {
          progress = (location.start.index || 0) / epubBook.spine.length;
        }
      } catch {
        progress = 0;
      }

      onMeta({
        chapter: chapterFor(location.start.href),
        progress,
        atStart: !!location.atStart,
        atEnd: !!location.atEnd,
      });
      onProgress(book.id, { location: cfi, progress });
    },
    [book.id, chapterFor, onMeta, onProgress],
  );

  /**
   * Turns the page with a slide-and-fade. epub.js swaps columns instantly, so
   * the animation runs on the host element and the swap is timed to land at its
   * midpoint, while the text is faded out.
   */
  const turnPage = useCallback(
    async (direction) => {
      const rendition = renditionRef.current;
      if (!rendition || turningRef.current) return;
      const go = () => (direction === 'next' ? rendition.next() : rendition.prev());

      const animate =
        settingsRef.current.pageAnimation !== false &&
        settingsRef.current.flow === 'paginated' &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (!animate) {
        await go().catch(() => {});
        return;
      }

      turningRef.current = true;
      closeMenu();
      setTurn(direction);
      const swapped = new Promise((resolve) => setTimeout(resolve, TURN_SWAP_MS));
      try {
        await swapped;
        await go().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, TURN_MS - TURN_SWAP_MS));
      } finally {
        setTurn(null);
        turningRef.current = false;
      }
    },
    [closeMenu],
  );

  const handleTap = useCallback(
    (clientX) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (settingsRef.current.flow === 'scrolled') {
        onToggleChrome();
        return;
      }
      const width = window.innerWidth;
      if (clientX < width * 0.28) turnPage('prev');
      else if (clientX > width * 0.72) turnPage('next');
      else onToggleChrome();
    },
    [onToggleChrome, turnPage],
  );

  const flashHighlight = useCallback((id) => {
    const highlight = highlightsRef.current.find((h) => h.id === id);
    if (!highlight || !renditionRef.current) return;
    renditionRef.current.display(highlight.cfi).catch(() => {});
  }, []);

  /* ------------------------------------------------------------- highlighter */

  /** Saves a highlight from a CFI range, wherever the range came from. */
  const saveHighlight = useCallback(
    ({ cfiRange, text, href, color, note = '' }) => {
      const epubBook = bookRef.current;
      return onCreateHighlight({
        bookId: book.id,
        format: 'epub',
        cfi: cfiRange,
        text,
        note,
        color,
        chapter: chapterFor(href || renditionRef.current?.currentLocation()?.start?.href),
        order: readingOrder(epubBook, cfiRange),
        createdAt: Date.now(),
      });
    },
    [book.id, chapterFor, onCreateHighlight],
  );

  /**
   * Turns highlighter mode on or off for one rendered section: suppresses the
   * native selection inside it and listens for drags across its text.
   */
  const setContentsMode = useCallback(
    (contents, on) => {
      const doc = contents?.document;
      if (!doc) return;
      const detachers = dragDetachRef.current;

      if (!on) {
        doc.getElementById(STYLE_ID)?.remove();
        detachers.get(doc)?.();
        detachers.delete(doc);
        return;
      }

      if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = HIGHLIGHTER_CSS;
        doc.head?.appendChild(style);
      }
      if (detachers.has(doc)) return;

      const frameRect = () => {
        const frame = doc.defaultView?.frameElement;
        return frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
      };

      detachers.set(
        doc,
        attachDragHighlighter({
          doc,
          isEnabled: () => highlighterRef.current,
          onPreview: (rects) => {
            if (!rects) {
              setPreview(null);
              return;
            }
            const offset = frameRect();
            setPreview({
              color: colorHex(settingsRef.current.defaultColor),
              rects: rects.map((r) => ({
                left: offset.left + r.left,
                top: offset.top + r.top,
                width: r.width,
                height: r.height,
              })),
            });
          },
          onCommit: ({ range, text }) => {
            try {
              const cfiRange = contents.cfiFromRange(range);
              if (!cfiRange) return;
              // href is left out: saveHighlight falls back to the location on
              // screen, which is the section this drag happened in.
              saveHighlight({ cfiRange, text, color: settingsRef.current.defaultColor });
            } catch (err) {
              console.warn('Could not anchor that highlight', err);
              notify('That passage could not be highlighted.', 'error');
            }
          },
          // A press that never moved is still a page turn or a chrome toggle.
          onTap: (x) => {
            const offset = frameRect();
            handleTap(x + offset.left);
          },
        }),
      );
    },
    [handleTap, notify, saveHighlight],
  );

  const applyMode = useCallback(
    (on) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      for (const contents of rendition.getContents() || []) setContentsMode(contents, on);
    },
    [setContentsMode],
  );

  // Sections load and unload as the reader moves, so the mode is re-applied to
  // whatever is on screen rather than set once.
  useEffect(() => {
    if (status !== 'ready') return;
    applyMode(highlighterOn);
    if (!highlighterOn) setPreview(null);
  }, [highlighterOn, status, applyMode]);

  useEffect(
    () => () => {
      for (const detach of dragDetachRef.current.values()) detach();
      dragDetachRef.current.clear();
    },
    [],
  );

  /* ------------------------------------------------------- book + rendition */

  // The view manager cannot be swapped in place, so a flow change rebuilds it.
  useEffect(() => {
    let cancelled = false;
    let rendition;
    let epubBook;

    (async () => {
      try {
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;

        epubBook = ePub(buffer);
        bookRef.current = epubBook;
        await epubBook.ready;
        if (cancelled) return;

        const scrolled = settingsRef.current.flow === 'scrolled';
        rendition = epubBook.renderTo(hostRef.current, {
          width: '100%',
          height: '100%',
          flow: scrolled ? 'scrolled' : 'paginated',
          manager: scrolled ? 'continuous' : 'default',
          spread: 'none',
          snap: false,
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        rendition.themes.register('marginalia', themeRules(settingsRef.current));
        rendition.themes.select('marginalia');
        rendition.themes.fontSize(`${settingsRef.current.fontSize}%`);

        tocRef.current = flatten(epubBook.navigation?.toc || []);
        onMeta({ toc: tocRef.current });

        rendition.on('relocated', (location) => {
          closeMenu();
          reportLocation(location);
        });

        rendition.on('rendered', () => {
          drawnRef.current.clear();
          paintHighlights(true);
          applyMode(highlighterRef.current);
          const pending = pendingFocusRef.current;
          if (pending) {
            pendingFocusRef.current = null;
            setTimeout(() => flashHighlight(pending), 150);
          }
        });

        rendition.on('selected', (cfiRange, contents) => {
          const selection = contents.window?.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const text = selection.toString().replace(/\s+/g, ' ').trim();
          if (!text) return;
          setMenu({
            mode: 'create',
            rect: viewportRect(selection.getRangeAt(0), contents),
            cfiRange,
            text,
            href: rendition.currentLocation()?.start?.href,
            clear: () => selection.removeAllRanges(),
          });
        });

        rendition.on('touchstart', (event) => {
          const touch = event.changedTouches?.[0];
          touchRef.current = touch ? { x: touch.clientX, y: touch.clientY, t: Date.now() } : null;
        });

        rendition.on('touchend', (event) => {
          const start = touchRef.current;
          touchRef.current = null;
          if (!start || settingsRef.current.flow === 'scrolled') return;
          const touch = event.changedTouches?.[0];
          if (!touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.4) {
            if (contentsHasSelection(event)) return;
            turnPage(dx < 0 ? 'next' : 'prev');
          }
        });

        rendition.on('click', (event, contents) => {
          if (Date.now() - markClickRef.current < 350) return;
          if (contents.window?.getSelection()?.toString().trim()) return;
          if (menuOpenRef.current) {
            closeMenu();
            return;
          }
          const frame = contents.document?.defaultView?.frameElement;
          const offsetLeft = frame ? frame.getBoundingClientRect().left : 0;
          handleTap((event.clientX ?? 0) + offsetLeft);
        });

        rendition.on('keyup', (event) => {
          if (event.key === 'ArrowRight' || event.key === 'PageDown') turnPage('next');
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') turnPage('prev');
        });

        await rendition.display(locationRef.current || undefined);
        if (cancelled) return;
        setStatus('ready');

        // Locations drive the progress percentage. Building them costs a pass
        // over the whole book, so the result is cached on the book record.
        if (book.locations) {
          try {
            epubBook.locations.load(book.locations);
          } catch {
            /* fall through and regenerate */
          }
        }
        if (!epubBook.locations.length()) {
          epubBook.locations
            .generate(1600)
            .then(() => {
              if (cancelled) return;
              onProgress(book.id, { locations: epubBook.locations.save() });
              reportLocation(rendition.currentLocation());
            })
            .catch(() => {});
        } else {
          reportLocation(rendition.currentLocation());
        }
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setStatus('error');
        notify('This EPUB could not be opened. The file may be damaged.', 'error');
      }
    })();

    return () => {
      cancelled = true;
      drawnRef.current.clear();
      try {
        rendition?.destroy();
      } catch {
        /* ignore teardown races */
      }
      try {
        epubBook?.destroy();
      } catch {
        /* ignore teardown races */
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, settings.flow]);

  /* ---------------------------------------------------- live setting changes */

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || status !== 'ready') return undefined;
    rendition.themes.register('marginalia', themeRules(settings));
    rendition.themes.select('marginalia');
    rendition.themes.fontSize(`${settings.fontSize}%`);

    // Typography and margin changes reflow the columns, so marks have to be
    // redrawn against the new layout.
    const timer = setTimeout(() => {
      try {
        rendition.resize();
      } catch {
        /* ignore */
      }
      paintHighlights(true);
      reportLocation(rendition.currentLocation());
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, status]);

  useEffect(() => {
    if (status === 'ready') paintHighlights(false);
  }, [highlights, status, paintHighlights]);

  useEffect(() => {
    const onResize = () => {
      closeMenu();
      paintHighlights(true);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [closeMenu, paintHighlights]);

  // Dismiss the toolbar when tapping the app chrome around the book.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = () => closeMenu();
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu, closeMenu]);

  // Escape closes the toolbar rather than the book: capture the key before the
  // reader's own handler sees it.
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      menu.clear?.();
      closeMenu();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, closeMenu]);

  useEffect(() => {
    pendingFocusRef.current = focusHighlightId;
    if (focusHighlightId && status === 'ready') {
      flashHighlight(focusHighlightId);
      pendingFocusRef.current = null;
    }
  }, [focusHighlightId, status, flashHighlight]);

  useImperativeHandle(
    ref,
    () => ({
      next: () => turnPage('next'),
      prev: () => turnPage('prev'),
      goTo: (target) => renditionRef.current?.display(target).catch(() => {}),
      goToHighlight: flashHighlight,
    }),
    [flashHighlight, turnPage],
  );

  /* ----------------------------------------------------------------- create */

  const createHighlight = useCallback(
    async (colorId, note = '') => {
      if (!menu || menu.mode !== 'create') return null;
      menu.clear?.();
      closeMenu();
      return saveHighlight({
        cfiRange: menu.cfiRange,
        text: menu.text,
        href: menu.href,
        color: colorId,
        note,
      });
    },
    [menu, closeMenu, saveHighlight],
  );

  const menuHighlight =
    menu?.mode === 'edit' ? highlights.find((h) => h.id === menu.id) || null : null;

  const hostClass = ['epub-host', turn ? `is-turning-${turn}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={highlighterOn ? 'epub-host-wrap is-highlighting' : 'epub-host-wrap'}
      style={{ padding: `2.5% ${settings.margin}%` }}
    >
      <div ref={hostRef} className={hostClass} />

      {preview && (
        <div className="drag-preview" aria-hidden="true">
          {preview.rects.map((rect, index) => (
            <span
              key={index}
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                background: preview.color,
              }}
            />
          ))}
        </div>
      )}

      {status === 'loading' && <div className="view-status">Opening book…</div>}
      {status === 'error' && <div className="view-status">This EPUB could not be opened.</div>}

      {menu && (
        <SelectionMenu
          rect={menu.rect}
          mode={menu.mode}
          color={menu.mode === 'edit' ? menuHighlight?.color : settings.defaultColor}
          onPick={(colorId) => {
            if (menu.mode === 'edit') {
              onUpdateHighlight(menu.id, { color: colorId });
              closeMenu();
            } else {
              createHighlight(colorId);
            }
          }}
          onNote={async () => {
            if (menu.mode === 'edit') {
              setNoteFor(menuHighlight);
              closeMenu();
            } else {
              const created = await createHighlight(settings.defaultColor);
              if (created) setNoteFor(created);
            }
          }}
          onCopy={async () => {
            const text = menu.mode === 'edit' ? menuHighlight?.text : menu.text;
            const ok = await copyToClipboard(text || '');
            notify(ok ? 'Copied' : 'Could not copy', ok ? 'success' : 'error');
            menu.clear?.();
            closeMenu();
          }}
          onDelete={() => {
            onDeleteHighlight(menu.id);
            closeMenu();
          }}
          onClose={() => {
            menu.clear?.();
            closeMenu();
          }}
        />
      )}

      {noteFor && (
        <NoteDialog
          quote={noteFor.text}
          note={noteFor.note}
          onSave={(note) => {
            onUpdateHighlight(noteFor.id, { note });
            setNoteFor(null);
          }}
          onClose={() => setNoteFor(null)}
        />
      )}
    </div>
  );
});

/**
 * epub.js passes these through as SVG attributes, so only real presentation
 * attributes belong here — the blend mode is applied to the whole mark pane
 * from styles.css, which is what actually composites against the page.
 */
function highlightStyle(color, theme) {
  const onDark = theme === 'dark' || theme === 'black';
  return {
    fill: colorHex(color),
    'fill-opacity': onDark ? '0.45' : '0.38',
  };
}

/**
 * A 0–1 position in the book, used to keep highlights in reading order.
 * Falls back to the spine position while the locations index is still building.
 */
function readingOrder(epubBook, cfi) {
  try {
    if (epubBook?.locations?.length()) {
      return epubBook.locations.percentageFromCfi(cfi) || 0;
    }
    const spineLength = epubBook?.spine?.length;
    if (spineLength) {
      const spinePos = new EpubCFI(cfi).spinePos;
      if (spinePos >= 0) return spinePos / spineLength;
    }
  } catch {
    /* an unparseable CFI just sorts first */
  }
  return 0;
}

function contentsHasSelection(event) {
  const doc = event?.target?.ownerDocument;
  return !!doc?.defaultView?.getSelection?.()?.toString().trim();
}

export default EpubView;
