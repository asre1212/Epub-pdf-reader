import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import PdfPage from './PdfPage.jsx';
import { animateScroll, createTurnQueue, shouldAnimate, swipeDirection, waitForPage } from '../lib/pageTurns.js';
import SelectionMenu from './SelectionMenu.jsx';
import NoteDialog from './NoteDialog.jsx';
import { closePdf, openPdf } from '../lib/pdf.js';
import { hitTest, normalizeSelectionRects } from '../lib/pdfRects.js';
import { attachDragHighlighter } from '../lib/dragHighlight.js';
import { recordTrace } from '../lib/highlighterTrace.js';
import { colorHex } from '../lib/highlightColors.js';
import { copyToClipboard } from '../lib/exportNotes.js';
import { createTapArbiter } from '../lib/tapArbiter.js';

const BUFFER = 2; // pages kept rendered on either side of the viewport

const PdfView = forwardRef(function PdfView(
  {
    blob,
    book,
    settings,
    highlights,
    focusHighlightId,
    onCreateHighlight,
    onUpdateHighlight,
    onDeleteHighlight,
    onUndeleteHighlight,
    onProgress,
    onMeta,
    onToggleChrome,
    onShowDiagnostics,
    highlighterOn,
    notify,
  },
  ref,
) {
  const scrollRef = useRef(null);
  const turnsRef = useRef(null);
  if (!turnsRef.current) turnsRef.current = createTurnQueue();
  const turningRef = useRef(false);
  const currentPageRef = useRef(1);
  const paginated = settings.flow === 'paginated';

  const pdfRef = useRef(null);
  const dimsRef = useRef(new Map()); // page -> { width, height } at scale 1
  const highlightsRef = useRef(highlights);
  const pendingFocusRef = useRef(focusHighlightId);
  const restoredRef = useRef(false);
  const pointerRef = useRef(null);
  const highlighterRef = useRef(highlighterOn);
  const settingsRef = useRef(settings);
  const [preview, setPreview] = useState(null);

  const [pdf, setPdf] = useState(null);
  const [status, setStatus] = useState('loading');
  const [numPages, setNumPages] = useState(0);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [range, setRange] = useState({ from: 1, to: 3 });
  const [currentPage, setCurrentPage] = useState(1);
  const [menu, setMenu] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [, forceSize] = useState(0);

  highlightsRef.current = highlights;
  highlighterRef.current = highlighterOn;
  settingsRef.current = settings;

  const closeMenu = useCallback(() => setMenu(null), []);

  const tapArbiterRef = useRef(null);
  if (!tapArbiterRef.current) tapArbiterRef.current = createTapArbiter();

  /* -------------------------------------------------------------- document */

  useEffect(() => {
    let cancelled = false;
    let doc;
    (async () => {
      try {
        doc = await openPdf(blob);
        if (cancelled) {
          closePdf(doc);
          return;
        }
        pdfRef.current = doc;
        setPdf(doc);
        setNumPages(doc.numPages);

        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        dimsRef.current.set(1, { width: base.width, height: base.height });
        if (!cancelled) setBaseSize({ width: base.width, height: base.height });

        const outline = await doc.getOutline().catch(() => null);
        if (!cancelled) onMeta({ toc: await flattenOutline(doc, outline) });
        if (!cancelled) setStatus('ready');
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setStatus('error');
        notify('This PDF could not be opened. The file may be damaged.', 'error');
      }
    })();

    return () => {
      cancelled = true;
      pdfRef.current = null;
      closePdf(doc).catch?.(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  /* ------------------------------------------------------------------ size */

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () =>
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const padding = Math.round((viewport.width * settings.margin) / 100);

  const scale = useMemo(() => {
    if (!viewport.width || !baseSize.width) return 1;
    const usableWidth = Math.max(160, viewport.width - padding * 2 - 2);
    const fitWidth = usableWidth / baseSize.width;
    if (settings.pdfFit === 'page') {
      const usableHeight = Math.max(160, viewport.height - 24);
      return Math.min(fitWidth, usableHeight / baseSize.height) * settings.pdfZoom;
    }
    return fitWidth * settings.pdfZoom;
  }, [viewport, baseSize, padding, settings.pdfFit, settings.pdfZoom]);

  const sizeOf = useCallback(
    (pageNumber) => {
      const dims = dimsRef.current.get(pageNumber) || baseSize;
      const usableWidth = Math.max(160, viewport.width - padding * 2 - 2);
      const pageScale = !viewport.width ? 1 : (settings.pdfFit === 'page'
        ? Math.min(usableWidth / dims.width, Math.max(160, viewport.height - 44) / dims.height)
        : usableWidth / dims.width) * settings.pdfZoom;
      return { width: Math.round(dims.width * pageScale), height: Math.round(dims.height * pageScale), scale: pageScale };
    },
    [baseSize, viewport.width, viewport.height, padding, settings.pdfFit, settings.pdfZoom],
  );

  const handleSized = useCallback((pageNumber, base) => {
    const known = dimsRef.current.get(pageNumber);
    if (known && Math.abs(known.width - base.width) < 0.5 && Math.abs(known.height - base.height) < 0.5) {
      return;
    }
    dimsRef.current.set(pageNumber, { width: base.width, height: base.height });
    forceSize((n) => n + 1);
  }, []);

  /* ---------------------------------------------------------------- scroll */

  const pageElements = useCallback(
    () => [...(scrollRef.current?.querySelectorAll('.pdf-page') || [])],
    [],
  );

  const syncScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !numPages || turningRef.current) return;
    const middle = element.scrollTop + element.clientHeight * 0.35;
    let page = 1;
    if (settingsRef.current.flow === 'paginated') {
      page = currentPageRef.current;
    } else {
      for (const node of pageElements()) {
        if (node.offsetTop <= middle) page = Number(node.dataset.page);
        else break;
      }
    }
    currentPageRef.current = page;
    setCurrentPage(page);
    const buffer = settingsRef.current.flow === 'paginated' ? 1 : BUFFER;
    setRange({ from: Math.max(1, page - buffer), to: Math.min(numPages, page + buffer) });

    const progress = numPages > 1 ? (page - 1) / (numPages - 1) : 1;
    onMeta({ page, numPages, progress });
    onProgress(book.id, { location: page, progress });
  }, [book.id, numPages, onMeta, onProgress, pageElements]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        syncScroll();
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [syncScroll]);

  const goToPage = useCallback((destination, behavior = 'auto') => {
    if (behavior === 'auto') turnsRef.current.cancel();
    return turnsRef.current.run(async (signal) => {
      const element = scrollRef.current;
      if (!element || !numPages) return;
      const pageNumber = Math.min(numPages, Math.max(1, typeof destination === 'function'
        ? destination(currentPageRef.current) : destination));
      if (settingsRef.current.flow !== 'paginated') {
        const target = element.querySelector(`.pdf-page[data-page="${pageNumber}"]`);
        element.scrollTo({ top: target?.offsetTop - 8 || 0, behavior:
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior });
        return;
      }
      turningRef.current = true;
      // Only the outgoing and destination neighborhoods need bitmaps, even
      // for a table-of-contents jump across a large document.
      setRange({ from: Math.max(1, pageNumber - 1), to: Math.min(numPages, pageNumber + 1) });
      try {
        await waitForPage(() => {
          const page = element.querySelector(`.pdf-page[data-page="${pageNumber}"]`);
          if (page?.dataset.renderError === 'true') throw new Error('PDF rendering failed');
          return page?.dataset.renderScale === String(sizeOf(pageNumber).scale);
        }, signal);
        if (signal.aborted) return;
        const adjacent = Math.abs(pageNumber - currentPageRef.current) === 1;
        await animateScroll(element, 'scrollLeft', (pageNumber - 1) * element.clientWidth,
          signal, adjacent && behavior !== 'auto' && shouldAnimate(settingsRef.current));
        // An aborted slide has landed on its destination; preserve that page
        // when reflowing. Cancellation during rendering leaves it untouched.
        currentPageRef.current = pageNumber;
        setCurrentPage(pageNumber);
        const progress = numPages > 1 ? (pageNumber - 1) / (numPages - 1) : 1;
        onMeta({ page: pageNumber, numPages, progress });
        onProgress(book.id, { location: pageNumber, progress });
      } finally {
        turningRef.current = false;
      }
    }).catch((error) => {
      if (error.name !== 'AbortError') notify('Could not render this page. Please try again.', 'error');
    });
  }, [numPages, sizeOf, book.id, onMeta, onProgress, notify]);

  // A resize or mode change invalidates pixel destinations. Land the old turn,
  // discard pending gestures, then restore the same logical page in the layout.
  useEffect(() => {
    turnsRef.current.cancel();
    pointerRef.current = null;
    if (restoredRef.current) {
      const frame = requestAnimationFrame(() => goToPage(currentPageRef.current));
      return () => { cancelAnimationFrame(frame); turnsRef.current.cancel(); };
    }
    return () => turnsRef.current.cancel();
  }, [viewport.width, viewport.height, scale, settings.flow, settings.pageAnimation, goToPage]);

  useEffect(() => {
    const cancel = () => { turnsRef.current.cancel(); pointerRef.current = null; };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', cancel);
    window.addEventListener('orientationchange', cancel);
    return () => {
      cancel();
      media.removeEventListener('change', cancel);
      window.removeEventListener('orientationchange', cancel);
    };
  }, []);

  // Restore the saved page once the first layout is in place.
  useEffect(() => {
    if (status !== 'ready' || restoredRef.current || !viewport.width || !numPages) return;
    restoredRef.current = true;
    const saved = Number(book.location);
    const target = Number.isFinite(saved) && saved >= 1 ? Math.min(saved, numPages) : 1;
    currentPageRef.current = target;
    setCurrentPage(target);
    setRange({ from: Math.max(1, target - BUFFER), to: Math.min(numPages, target + BUFFER) });
    const frame = requestAnimationFrame(() => {
      goToPage(target);
      onMeta({
        page: target,
        numPages,
        progress: numPages > 1 ? (target - 1) / (numPages - 1) : 1,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [status, viewport.width, numPages, book.location, goToPage, onMeta]);

  /* ------------------------------------------------------------- selection */

  const pageBoxes = useCallback(
    () =>
      pageElements().map((node) => ({
        page: Number(node.dataset.page),
        box: node.getBoundingClientRect(),
      })),
    [pageElements],
  );

  /** The topmost highlight under a viewport point, with where it sits on screen. */
  const highlightAt = useCallback(
    (clientX, clientY) => {
      // Locate the page by coordinates rather than by event target: a tap can
      // land on the text layer, a span, or the page margin.
      const hitPage = pageBoxes().find(
        ({ box }) =>
          clientX >= box.left &&
          clientX <= box.right &&
          clientY >= box.top &&
          clientY <= box.bottom,
      );
      if (!hitPage) return null;
      const { box, page } = hitPage;
      const x = (clientX - box.left) / box.width;
      const y = (clientY - box.top) / box.height;
      const hit = [...highlightsRef.current]
        .reverse()
        .find((highlight) => hitTest(highlight, page, x, y));
      if (!hit) return null;
      const first = hit.rects.find((rect) => rect.p === page) || hit.rects[0];
      return {
        id: hit.id,
        rect: {
          left: box.left + first.x * box.width,
          top: box.top + first.y * box.height,
          width: first.w * box.width,
          height: first.h * box.height,
        },
      };
    },
    [pageBoxes],
  );

  /**
   * Removes a highlight the reader tapped, with a way back. Tapping to erase is
   * quick precisely because it asks nothing first, so the undo is not a nicety:
   * it is the confirmation, moved to after the fact.
   */
  const eraseHighlight = useCallback(
    (id) => {
      const gone = highlightsRef.current.find((h) => h.id === id);
      if (!gone) return;
      closeMenu();
      onDeleteHighlight(id);
      notify('Highlight erased', 'info', {
        label: 'Undo',
        onAct: () => onUndeleteHighlight(gone),
      });
    },
    [closeMenu, notify, onUndeleteHighlight, onDeleteHighlight],
  );

  /** One tap opens the highlight; two erase it, when that is switched on. */
  const tapHighlight = useCallback(
    (hit) => {
      const openMenu = () => setMenu({ mode: 'edit', id: hit.id, rect: hit.rect });
      if (!settingsRef.current.tapToErase) {
        openMenu();
        return;
      }
      tapArbiterRef.current.tap(hit.id, {
        onSingle: openMenu,
        onDouble: () => eraseHighlight(hit.id),
      });
    },
    [eraseHighlight],
  );

  const readSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const domRange = selection.getRangeAt(0);
    if (!scrollRef.current?.contains(domRange.commonAncestorContainer)) return null;
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const rects = normalizeSelectionRects(domRange, pageBoxes());
    if (!rects.length) return null;
    const box = domRange.getBoundingClientRect();
    return {
      text,
      rects,
      rect: { left: box.left, top: box.top, width: box.width, height: box.height },
      clear: () => selection.removeAllRanges(),
    };
  }, [pageBoxes]);

  const onPointerUp = useCallback(
    (event) => {
      if (highlighterRef.current) return; // the drag highlighter owns the gesture
      const start = pointerRef.current;
      pointerRef.current = null;

      if (!start || start.pointerId !== event.pointerId) return;
      const swipe = swipeDirection(start, event);
      if (swipe && settingsRef.current.flow === 'paginated' && settingsRef.current.pdfZoom <= 1 &&
          !window.getSelection()?.toString().trim()) {
        closeMenu();
        goToPage((page) => page + (swipe === 'next' ? 1 : -1), 'smooth');
        return;
      }
      const selected = readSelection();
      if (selected) {
        setMenu({ mode: 'create', ...selected });
        return;
      }

      // No selection: either a tap on an existing highlight, or a plain tap.
      const moved =
        start && (Math.abs(event.clientX - start.x) > 6 || Math.abs(event.clientY - start.y) > 6);
      if (moved) return;

      const hit = highlightAt(event.clientX, event.clientY);
      if (hit) {
        tapHighlight(hit);
        return;
      }

      if (menu) {
        closeMenu();
        return;
      }
      const box = scrollRef.current.getBoundingClientRect();
      const fraction = (event.clientX - box.left) / box.width;
      if (settingsRef.current.flow === 'paginated' && (fraction < 0.2 || fraction > 0.8)) {
        goToPage((page) => page + (fraction < 0.2 ? -1 : 1), 'smooth');
      } else onToggleChrome();
    },
    [goToPage, readSelection, highlightAt, tapHighlight, menu, closeMenu, onToggleChrome],
  );

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
    const onKey = (event) => {
      if (event.target?.closest?.('input, textarea')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goToPage((page) => page + 1, 'smooth');
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage((page) => page - 1, 'smooth');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, numPages, goToPage]);

  /* ------------------------------------------------------------- highlights */

  /** Saves a highlight from normalised page rects, wherever they came from. */
  const saveHighlight = useCallback(
    ({ rects, text, color, note = '' }) => {
      const first = rects[0];
      return onCreateHighlight({
        bookId: book.id,
        format: 'pdf',
        page: first.p,
        rects,
        text,
        note,
        color,
        order: first.p + first.y,
        createdAt: Date.now(),
      });
    },
    [book.id, onCreateHighlight],
  );

  // Highlighter mode: drag across the text layer instead of selecting it, using
  // the same engine as the EPUB view pointed at the top-level document.
  useEffect(() => {
    if (!highlighterOn) {
      setPreview(null);
      return undefined;
    }
    return attachDragHighlighter({
      doc: document,
      isEnabled: () => highlighterRef.current,
      containerFor: (target) => target?.closest?.('.pdf-page'),
      // Long documents keep many pages in the DOM; only the ones on screen are
      // candidates for the nearest word to a finger.
      visibleBox: () => {
        const box = scrollRef.current?.getBoundingClientRect();
        return box && { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      },
      onPreview: (rects) =>
        setPreview(
          rects && {
            color: colorHex(settings.defaultColor),
            rects: rects.map((r) => ({
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
            })),
          },
        ),
      onCommit: ({ range, text, trace }) => {
        const rects = normalizeSelectionRects(range, pageBoxes());
        const close = (outcome, anchored) => {
          if (!trace || trace.outcome !== undefined) return;
          trace.outcome = outcome;
          recordTrace({ ...trace, anchored, view: 'pdf', flow: settings.flow });
        };
        if (!rects.length) {
          close('no-rects', false);
          notify('That passage could not be placed on the page.', 'error');
          return;
        }
        close('highlighted', true);
        saveHighlight({ rects, text, color: settings.defaultColor });
      },
      // A tap while the highlighter is on still lands on the page, so it is the
      // eraser's chance to act before anything else reads it.
      onTap: (x, y) => {
        const hit = highlightAt(x, y);
        if (hit) {
          tapHighlight(hit);
          return;
        }
        onToggleChrome();
      },
      // Two fingers scroll the document while the highlighter has the surface.
      onPan: ({ phase, stepY }) => {
        if (phase !== 'move') return;
        const root = scrollRef.current;
        const scroller = settingsRef.current.flow === 'paginated'
          ? root?.children[currentPageRef.current - 1] : root;
        if (scroller) scroller.scrollTop -= stepY;
      },
      onMiss: (reason) =>
        notify(
          reason === 'no-text-found'
            ? 'Could not read the text on this page to highlight it.'
            : 'No text under that drag — try across a line.',
          'error',
          onShowDiagnostics && { label: 'Why?', onAct: onShowDiagnostics },
        ),
      onTrace: (entry) => recordTrace({ ...entry, view: 'pdf', flow: settings.flow }),
    });
  }, [
    highlighterOn,
    settings.defaultColor,
    pageBoxes,
    saveHighlight,
    highlightAt,
    tapHighlight,
    onToggleChrome,
    onShowDiagnostics,
    settings.flow,
    notify,
  ]);

  const createHighlight = useCallback(
    async (colorId, note = '') => {
      if (!menu || menu.mode !== 'create') return null;
      menu.clear?.();
      closeMenu();
      return saveHighlight({ rects: menu.rects, text: menu.text, color: colorId, note });
    },
    [menu, closeMenu, saveHighlight],
  );

  const focusHighlight = useCallback(
    (id) => {
      const highlight = highlightsRef.current.find((h) => h.id === id);
      if (!highlight) return;
      turnsRef.current.cancel();
      goToPage(highlight.page, 'smooth');
    },
    [goToPage],
  );

  useEffect(() => {
    pendingFocusRef.current = focusHighlightId;
    if (focusHighlightId && status === 'ready' && restoredRef.current) {
      const id = focusHighlightId;
      pendingFocusRef.current = null;
      setTimeout(() => focusHighlight(id), 220);
    }
  }, [focusHighlightId, status, focusHighlight]);

  useImperativeHandle(
    ref,
    () => ({
      next: () => goToPage((page) => page + 1, 'smooth'),
      prev: () => goToPage((page) => page - 1, 'smooth'),
      goTo: (target) => {
        turnsRef.current.cancel();
        const page = Number(target);
        if (Number.isFinite(page)) return goToPage(Math.min(Math.max(1, page), numPages), 'smooth');
      },
      goToHighlight: focusHighlight,
    }),
    [goToPage, currentPage, numPages, focusHighlight],
  );

  /* ---------------------------------------------------------------- render */

  const byPage = useMemo(() => {
    const map = new Map();
    for (const highlight of highlights) {
      for (const rect of highlight.rects || []) {
        if (!map.has(rect.p)) map.set(rect.p, new Set());
        map.get(rect.p).add(highlight);
      }
    }
    return map;
  }, [highlights]);

  const menuHighlight =
    menu?.mode === 'edit' ? highlights.find((h) => h.id === menu.id) || null : null;
  const invert = settings.theme === 'dark' || settings.theme === 'black';

  return (
    <>
      <div
        ref={scrollRef}
        className={[
          'pdf-scroll',
          paginated ? 'pdf-horizontal' : '',
          settings.pdfZoom > 1 ? 'is-zoomed' : '',
          highlighterOn ? 'is-highlighting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={paginated ? undefined : { padding: `12px ${padding}px 32px` }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || highlighterRef.current) {
            pointerRef.current = null;
            return;
          }
          pointerRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        }}
        onPointerCancel={() => { pointerRef.current = null; }}
        onLostPointerCapture={() => { pointerRef.current = null; }}
        onPointerUp={onPointerUp}
      >
        {status === 'loading' && <div className="view-status">Opening book…</div>}
        {status === 'error' && <div className="view-status">This PDF could not be opened.</div>}

        {pdf &&
          Array.from({ length: numPages }, (_, index) => index + 1).map((pageNumber) => {
            const { width, height, scale: pageScale } = sizeOf(pageNumber);
            const page = (
              <PdfPage
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                scale={pageScale}
                width={width}
                height={height}
                active={(pageNumber >= range.from && pageNumber <= range.to) || (paginated && pageNumber === currentPage)}
                invert={invert}
                highlights={[...(byPage.get(pageNumber) || [])]}
                onSized={handleSized}
              />
            );
            return paginated ? (
              <div key={pageNumber} className="pdf-page-slot" inert={pageNumber !== currentPage} style={{ padding: `12px ${padding}px 32px` }}>
                {page}
              </div>
            ) : page;
          })}
      </div>

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
          key={noteFor.id}
          draftKey={`highlight:${noteFor.id}:note`}
          quote={noteFor.text}
          note={noteFor.note}
          onSave={async (note) => {
            await onUpdateHighlight(noteFor.id, { note });
            setNoteFor(null);
          }}
          onClose={() => setNoteFor(null)}
        />
      )}
    </>
  );
});

/** Turns a PDF outline into the same flat shape the EPUB TOC uses. */
async function flattenOutline(pdf, outline, depth = 0, out = []) {
  for (const item of outline || []) {
    let page = null;
    try {
      const dest =
        typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      if (dest?.[0]) {
        const index = await pdf.getPageIndex(dest[0]);
        page = index + 1;
      }
    } catch {
      /* a broken destination just means no jump target */
    }
    if (page) out.push({ id: `${depth}-${out.length}`, href: page, label: item.title, depth });
    if (item.items?.length) await flattenOutline(pdf, item.items, depth + 1, out);
  }
  return out;
}

export default PdfView;
