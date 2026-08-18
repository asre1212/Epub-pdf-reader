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
import SelectionMenu from './SelectionMenu.jsx';
import NoteDialog from './NoteDialog.jsx';
import { closePdf, openPdf } from '../lib/pdf.js';
import { hitTest, normalizeSelectionRects } from '../lib/pdfRects.js';
import { attachDragHighlighter } from '../lib/dragHighlight.js';
import { copyToClipboard } from '../lib/exportNotes.js';

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
    onProgress,
    onMeta,
    onToggleChrome,
    highlighterOn,
    notify,
  },
  ref,
) {
  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const dimsRef = useRef(new Map()); // page -> { width, height } at scale 1
  const highlightsRef = useRef(highlights);
  const pendingFocusRef = useRef(focusHighlightId);
  const restoredRef = useRef(false);
  const pointerRef = useRef(null);
  const highlighterRef = useRef(highlighterOn);
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

  const closeMenu = useCallback(() => setMenu(null), []);

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
      return { width: Math.round(dims.width * scale), height: Math.round(dims.height * scale) };
    },
    [baseSize, scale],
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
    if (!element || !numPages) return;
    const middle = element.scrollTop + element.clientHeight * 0.35;
    let page = 1;
    for (const node of pageElements()) {
      if (node.offsetTop <= middle) page = Number(node.dataset.page);
      else break;
    }
    setCurrentPage(page);
    setRange({ from: Math.max(1, page - BUFFER), to: Math.min(numPages, page + BUFFER) });

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

  const goToPage = useCallback(
    (pageNumber, behavior = 'auto') => {
      const element = scrollRef.current;
      if (!element) return;
      const target = element.querySelector(`.pdf-page[data-page="${pageNumber}"]`);
      if (target) {
        element.scrollTo({ top: target.offsetTop - 8, behavior });
      } else {
        // Not mounted yet (a long jump): estimate from the known page size.
        const { height } = sizeOf(1);
        element.scrollTo({ top: (pageNumber - 1) * (height + 16), behavior });
      }
      setRange({
        from: Math.max(1, pageNumber - BUFFER),
        to: Math.min(numPages || pageNumber, pageNumber + BUFFER),
      });
    },
    [numPages, sizeOf],
  );

  // Restore the saved page once the first layout is in place.
  useEffect(() => {
    if (status !== 'ready' || restoredRef.current || !viewport.width || !numPages) return;
    restoredRef.current = true;
    const saved = Number(book.location);
    const target = Number.isFinite(saved) && saved >= 1 ? Math.min(saved, numPages) : 1;
    setCurrentPage(target);
    setRange({ from: Math.max(1, target - BUFFER), to: Math.min(numPages, target + BUFFER) });
    requestAnimationFrame(() => {
      goToPage(target);
      onMeta({
        page: target,
        numPages,
        progress: numPages > 1 ? (target - 1) / (numPages - 1) : 1,
      });
    });
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

      const selected = readSelection();
      if (selected) {
        setMenu({ mode: 'create', ...selected });
        return;
      }

      // No selection: either a tap on an existing highlight, or a plain tap.
      const moved =
        start && (Math.abs(event.clientX - start.x) > 6 || Math.abs(event.clientY - start.y) > 6);
      if (moved) return;

      // Locate the page by coordinates rather than by event target: a tap can
      // land on the text layer, a span, or the page margin.
      const hitPage = pageBoxes().find(
        ({ box }) =>
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom,
      );
      if (hitPage) {
        const { box, page } = hitPage;
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        const hit = [...highlightsRef.current]
          .reverse()
          .find((highlight) => hitTest(highlight, page, x, y));
        if (hit) {
          const first = hit.rects.find((rect) => rect.p === page) || hit.rects[0];
          setMenu({
            mode: 'edit',
            id: hit.id,
            rect: {
              left: box.left + first.x * box.width,
              top: box.top + first.y * box.height,
              width: first.w * box.width,
              height: first.h * box.height,
            },
          });
          return;
        }
      }

      if (menu) {
        closeMenu();
        return;
      }
      onToggleChrome();
    },
    [readSelection, pageBoxes, menu, closeMenu, onToggleChrome],
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
        goToPage(Math.min(numPages, currentPage + 1), 'smooth');
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage(Math.max(1, currentPage - 1), 'smooth');
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
      onCommit: ({ range, text }) => {
        const rects = normalizeSelectionRects(range, pageBoxes());
        if (!rects.length) return;
        saveHighlight({ rects, text, color: settings.defaultColor });
      },
      onTap: () => onToggleChrome(),
      onMiss: () => notify('No text under that drag — try across a line.'),
    });
  }, [highlighterOn, settings.defaultColor, pageBoxes, saveHighlight, onToggleChrome, notify]);

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
      next: () => goToPage(Math.min(numPages, currentPage + 1), 'smooth'),
      prev: () => goToPage(Math.max(1, currentPage - 1), 'smooth'),
      goTo: (target) => {
        const page = Number(target);
        if (Number.isFinite(page)) goToPage(Math.min(Math.max(1, page), numPages), 'smooth');
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
          settings.flow === 'paginated' ? 'is-snapping' : '',
          highlighterOn ? 'is-highlighting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ padding: `12px ${padding}px 32px` }}
        onPointerDown={(event) => {
          pointerRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={onPointerUp}
      >
        {status === 'loading' && <div className="view-status">Opening book…</div>}
        {status === 'error' && <div className="view-status">This PDF could not be opened.</div>}

        {pdf &&
          Array.from({ length: numPages }, (_, index) => index + 1).map((pageNumber) => {
            const { width, height } = sizeOf(pageNumber);
            return (
              <PdfPage
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                scale={scale}
                width={width}
                height={height}
                active={pageNumber >= range.from && pageNumber <= range.to}
                invert={invert}
                highlights={[...(byPage.get(pageNumber) || [])]}
                onSized={handleSized}
              />
            );
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
          quote={noteFor.text}
          note={noteFor.note}
          onSave={(note) => {
            onUpdateHighlight(noteFor.id, { note });
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
