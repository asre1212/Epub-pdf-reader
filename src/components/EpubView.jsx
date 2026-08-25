import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ePub, { EpubCFI } from 'epubjs';
import SelectionMenu from './SelectionMenu.jsx';
import NoteDialog from './NoteDialog.jsx';
import { colorHex } from '../lib/highlightColors.js';
import {
  HIGHLIGHTER_CSS,
  attachDragHighlighter,
  caretFromApi,
  caretRangeAt,
  countTextNodes,
  indexForDrag,
  rangeBetween,
  rectsOf,
  snapToWords,
} from '../lib/dragHighlight.js';
import { recordTrace } from '../lib/highlighterTrace.js';
import { FONT_STACKS, THEMES } from '../lib/settings.js';
import { createTapArbiter } from '../lib/tapArbiter.js';
import { copyToClipboard } from '../lib/exportNotes.js';

const HIGHLIGHT_CLASS = 'marginalia-hl';
const SWIPE_MIN = 45;
const STYLE_ID = 'marginalia-highlighter-mode';
// The share of the width at each edge that turns the page. Used both to decide
// what a tap means and to keep tap-to-erase out of the way of it.
const TURN_ZONE = 0.28;
// Room at the top and bottom of the page for reaching the bars above and below
// it. A finger aimed at the back button is wider than the gap above the first
// line, and catching a highlight on the way there is the worst possible answer.
const ERASE_EDGE = 44;
// How far two fingers must travel before it counts as a page turn rather than a
// hand resting on the screen.
const PAN_TURN = 40;
const TURN_MS = 280;
const TURN_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

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

/**
 * Slides the rendered page across after epub.js has already turned it.
 *
 * epub.js pages a chapter by scrolling its container over one very wide iframe,
 * so a turn is instant. Replaying it is a matter of putting the content back
 * where it came from and letting it travel: the element that moves is the view
 * *inside* the clip, which is a plain translation of what is already painted.
 *
 * The earlier version animated the whole stage and faded it to nothing at the
 * midpoint, which is where it broke — WebKit will not keep compositing an iframe
 * under an animating opacity, so on iOS the page blinked out and back rather
 * than turning. Nothing fades here, and if a browser refuses to animate the
 * transform it simply arrives, which is the behaviour with animation off.
 */
function slidePages(container, shift, ms) {
  const views = [...container.children];
  if (!views.length || !shift) return Promise.resolve();

  for (const view of views) {
    view.style.willChange = 'transform';
    view.style.transition = 'none';
    view.style.transform = `translate3d(${shift}px, 0, 0)`;
  }
  // Commit the starting offset before the transition is armed.
  void container.offsetHeight;

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      for (const view of views) {
        view.style.transition = `transform ${ms}ms ${TURN_EASE}`;
        view.style.transform = 'translate3d(0, 0, 0)';
      }
      setTimeout(resolve, ms + 20);
    });
  });
}

/**
 * Slides the page by scrolling, which is how epub.js moves it anyway.
 *
 * The transform version below animates an element that contains the book's
 * iframe, and WebKit is famously reluctant to keep compositing an iframe under
 * an animating ancestor. Scrolling has no such problem here for the plainest of
 * reasons: an instant scroll is exactly what a page turn already is, so the new
 * position demonstrably paints. This just walks there instead of jumping.
 *
 * epub.js reports the reading position from its `scrolled` event, which it
 * debounces 20ms past the last movement — so it fires once, after this has
 * finished, at the position that is actually correct.
 */
function slideScroll(container, from, to, ms, isCurrent, onStop) {
  return new Promise((resolve) => {
    if (from === to) {
      resolve();
      return;
    }
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      container.scrollLeft = to;
      onStop?.(null);
      resolve();
    };
    onStop?.(settle);

    const startedAt = performance.now();
    container.scrollLeft = from;
    const step = (now) => {
      if (done) return;
      if (!isCurrent() || !container.isConnected) {
        settle();
        return;
      }
      const t = Math.min(1, (now - startedAt) / ms);
      const eased = 1 - (1 - t) ** 3;
      container.scrollLeft = from + (to - from) * eased;
      if (t < 1) requestAnimationFrame(step);
      else settle();
    };
    requestAnimationFrame(step);
  });
}

function clearSlide(container) {
  for (const view of container?.children || []) {
    view.style.transition = '';
    view.style.transform = '';
    view.style.willChange = '';
  }
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
  // The transparent sheet that hears the highlighter's drags, and the detach
  // for the listener bound to the top-level document while it is up.
  const catcherRef = useRef(null);
  const dragDetachRef = useRef(null);
  // Counts events that actually arrive inside the book's frame, so a device can
  // say whether anything in there is heard at all.
  const witnessRef = useRef({ click: 0, touchstart: 0, touchend: 0 });
  const witnessedDocs = useRef(new WeakSet());
  // Bumped on every turn so an animation still running can tell it was replaced.
  const turnRef = useRef(0);
  // Lands an in-flight scroll slide immediately, so the next turn starts from a
  // position that is settled rather than halfway.
  const slideStopRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const [markBoxes, setMarkBoxes] = useState([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const [status, setStatus] = useState('loading');
  const [menu, setMenu] = useState(null);
  const [noteFor, setNoteFor] = useState(null);

  highlightsRef.current = highlights;
  settingsRef.current = settings;
  menuOpenRef.current = !!menu;
  highlighterRef.current = highlighterOn;

  const closeMenu = useCallback(() => setMenu(null), []);

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

  // The annotation callbacks are handed to epub.js once, so they reach the
  // current eraser through a ref rather than capturing yesterday's.
  const eraseRef = useRef(eraseHighlight);
  eraseRef.current = eraseHighlight;

  const tapArbiterRef = useRef(null);
  if (!tapArbiterRef.current) tapArbiterRef.current = createTapArbiter();

  /**
   * What a tap on a highlight does.
   *
   * With double-tap erasing off, one tap opens the mark's menu as it always
   * has. With it on, the two gestures compete for the same tap, so the menu
   * waits out the double-tap window and a second tap erases instead — the
   * ordinary resolution, and the reason the destructive one now takes two.
   */
  const tapMark = useCallback(
    (mark) => {
      markClickRef.current = Date.now();
      const openMenu = () => setMenu({ mode: 'edit', id: mark.id, rect: mark.rect });
      if (!settingsRef.current.tapToErase) {
        openMenu();
        return;
      }
      tapArbiterRef.current.tap(mark.id, {
        onSingle: openMenu,
        onDouble: () => eraseRef.current(mark.id),
      });
    },
    [],
  );

  // epub.js and the rendition's own handlers are wired once, so they reach the
  // current arbiter through a ref rather than capturing the first one.
  const tapMarkRef = useRef(tapMark);
  tapMarkRef.current = tapMark;

  /**
   * The part of the page where a tap means "erase this highlight".
   *
   * Not all of it. The columns at either edge already belong to the page turn,
   * and the strips above and below the text are where a hand goes to reach the
   * bars — back to the library, the contents, the settings. A highlight can
   * easily run through all of those, and having it answer there means the tap
   * that was meant to leave the book deletes something instead.
   *
   * So a mark is only tappable across the middle of the page. The ends of a
   * long highlight fall in the turn columns and turn the page, which is what
   * tapping there does everywhere else on the page.
   */
  const eraseZone = useCallback(() => {
    const stage = hostRef.current?.closest('.reader-stage');
    if (!stage) return null;
    const box = stage.getBoundingClientRect();
    const scrolled = settingsRef.current.flow === 'scrolled';
    // Continuously scrolled books have no turn columns to keep clear.
    const edge = scrolled ? 0 : window.innerWidth * TURN_ZONE;
    const zone = {
      left: box.left + edge,
      right: box.right - edge,
      top: box.top + ERASE_EDGE,
      bottom: box.bottom - ERASE_EDGE,
    };
    // A stage too small to hold a zone leaves the page to navigation.
    if (zone.right - zone.left < 24 || zone.bottom - zone.top < 24) return null;
    return zone;
  }, []);

  /**
   * Where every highlight sits on screen, in viewport coordinates.
   *
   * This exists because epub.js cannot be relied on to tell us a highlight was
   * tapped. It builds its mark pane over the iframe and then detects taps by
   * listening *inside* the iframe and matching coordinates — the one place this
   * app has proven a touch never arrives on iOS. So the marks are measured out
   * here, and a plain element in the top-level document is put over each one.
   */
  const measureMarks = useCallback(() => {
    const host = hostRef.current;
    const zone = eraseZone();
    if (!host || !zone) {
      setMarkBoxes([]);
      return;
    }
    const boxes = [];
    for (const mark of host.querySelectorAll(`.${HIGHLIGHT_CLASS}[data-id]`)) {
      const id = mark.dataset.id;
      // A highlight spanning lines is a group of rectangles, and the gaps
      // between them are not part of it.
      const parts = mark.children.length ? [...mark.children] : [mark];
      for (const part of parts) {
        const box = part.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        // Clipped rather than dropped: a line running the width of the page
        // stays tappable across the middle, and its ends turn the page.
        const left = Math.max(box.left, zone.left);
        const top = Math.max(box.top, zone.top);
        const width = Math.min(box.right, zone.right) - left;
        const height = Math.min(box.bottom, zone.bottom) - top;
        if (width < 8 || height < 8) continue;
        boxes.push({ id, key: `${id}-${boxes.length}`, left, top, width, height });
      }
    }
    setMarkBoxes(boxes);
  }, [eraseZone]);

  /**
   * The highlight under a point on screen.
   *
   * While the highlighter is on the catcher covers epub.js's mark pane, so a
   * tap on a highlight cannot reach it — and no hit-testing API will find it
   * either: the marks are painted into an SVG pane that is `pointer-events:
   * none`, so `elementsFromPoint` looks straight through them. Measuring the
   * rectangles is the only reading that answers.
   */
  const markAt = useCallback((x, y) => {
    // The same bounds the visible targets are clipped to, so the highlighter's
    // own taps and the reader's agree about where erasing is possible.
    const zone = eraseZone();
    if (!zone) return null;
    if (x < zone.left || x > zone.right || y < zone.top || y > zone.bottom) return null;

    const marks = document.querySelectorAll(`.${HIGHLIGHT_CLASS}[data-id]`);
    // Last drawn sits on top, so it is the one a tap means.
    for (const mark of [...marks].reverse()) {
      // A highlight spanning lines is a group of rectangles; its own bounding
      // box would also swallow the gap between them.
      const boxes = mark.children.length
        ? [...mark.children].map((child) => child.getBoundingClientRect())
        : [mark.getBoundingClientRect()];
      const hit = boxes.find(
        (box) => x >= box.left - 2 && x <= box.right + 2 && y >= box.top - 2 && y <= box.bottom + 2,
      );
      if (!hit) continue;
      return {
        id: mark.dataset.id,
        rect: { left: hit.left, top: hit.top, width: hit.width, height: hit.height },
      };
    }
    return null;
  }, [eraseZone]);

  // A range can be flawless and still fail to become a highlight, so a trace is
  // closed when the mark is saved rather than when the drag ended.
  const closeTrace = useCallback((trace, outcome, extra) => {
    if (!trace || trace.outcome !== undefined) return;
    trace.outcome = outcome;
    recordTrace({ ...trace, ...extra, view: 'epub', flow: settingsRef.current.flow });
  }, []);

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
            const target = event?.currentTarget || event?.target;
            const box = target?.getBoundingClientRect?.();
            tapMarkRef.current({
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
   * Turns the page, then replays the turn as a slide.
   *
   * The turn itself happens first and unconditionally, so a tap is never held
   * up by the animation and rapid turns cannot fall behind. What follows is
   * cosmetic: the page that just arrived is put back where it came from and
   * released. A turn that crosses into a new chapter has no scroll distance to
   * measure, so it borrows one page width and slides in from the same side.
   */
  const turnPage = useCallback(
    async (direction) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const container = hostRef.current?.querySelector('.epub-container');
      const token = ++turnRef.current;
      closeMenu();
      // A turn arriving mid-slide takes over: land the old one first, so what
      // this one reads as the current position is the settled one.
      slideStopRef.current?.();
      slideStopRef.current = null;
      if (container) clearSlide(container);

      const go = () => (direction === 'next' ? rendition.next() : rendition.prev());
      const animate =
        settingsRef.current.pageAnimation !== false &&
        settingsRef.current.flow === 'paginated' &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      if (!animate || !container) {
        await go().catch(() => {});
        return;
      }

      const fromView = container.firstElementChild;
      const fromScroll = container.scrollLeft;
      await go().catch(() => {});
      if (token !== turnRef.current || !container.isConnected) return;

      const sectionChanged = container.firstElementChild !== fromView;
      const scrolled = sectionChanged ? 0 : container.scrollLeft - fromScroll;
      const pageWidth = rendition.manager?.layout?.delta || container.offsetWidth;
      // Nothing moved and nothing loaded: the book has no page that way.
      if (!scrolled && !sectionChanged) return;
      // Inside a chapter the turn is a scroll, so it can be replayed as one.
      // Crossing into a new chapter is not — there is nothing behind the new
      // page to scroll away from — so that one still travels by transform.
      if (!sectionChanged && scrolled) {
        await slideScroll(
          container,
          fromScroll,
          fromScroll + scrolled,
          TURN_MS,
          () => token === turnRef.current,
          (stop) => {
            slideStopRef.current = stop;
          },
        );
        return;
      }

      const shift = scrolled || (direction === 'next' ? pageWidth : -pageWidth);
      await slidePages(container, shift, TURN_MS);
      if (token === turnRef.current && container.isConnected) clearSlide(container);
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
      if (clientX < width * TURN_ZONE) turnPage('prev');
      else if (clientX > width * (1 - TURN_ZONE)) turnPage('next');
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
   * Puts the highlighter's CSS into a rendered section, and takes it out again.
   *
   * All this does now is stop iOS offering its callout over the text. The drag
   * itself is heard somewhere else entirely — see the catcher below.
   */
  const setContentsMode = useCallback((contents, on) => {
    const doc = contents?.document;
    if (!doc) return;
    if (!on) {
      doc.getElementById(STYLE_ID)?.remove();
      return;
    }
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = HIGHLIGHTER_CSS;
    doc.head?.appendChild(style);
  }, []);

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

  /**
   * The catcher: a transparent sheet over the book that hears the drag.
   *
   * The highlighter used to listen inside epub.js's iframe, and on iOS the
   * gesture never arrived — a device reported dozens of failed highlights and
   * not one recorded gesture, meaning the touch never reached the listener at
   * all. The PDF view has always listened on the top-level document and has
   * always worked on the same phone, which leaves the iframe as the only
   * difference between them.
   *
   * So the events are heard out here, where they demonstrably arrive, and the
   * text is still measured in there, where it lives. `measureIn` carries the
   * offset between the two.
   */
  useEffect(() => {
    if (!highlighterOn || status !== 'ready') return undefined;

    const detach = attachDragHighlighter({
      doc: document,
      containerFor: (target) => target === catcherRef.current,
      measureIn: () => {
        const contents = renditionRef.current?.getContents?.()?.[0];
        const frame = contents?.document?.defaultView?.frameElement;
        if (!contents?.document || !frame) return null;
        const rect = frame.getBoundingClientRect();
        return { doc: contents.document, offsetX: rect.left, offsetY: rect.top };
      },
      visibleBox: () => {
        const contents = renditionRef.current?.getContents?.()?.[0];
        const frame = contents?.document?.defaultView?.frameElement;
        const container = frame?.closest?.('.epub-container');
        if (!frame || !container) return null;
        const inner = frame.getBoundingClientRect();
        const outer = container.getBoundingClientRect();
        return {
          left: outer.left - inner.left,
          top: outer.top - inner.top,
          right: outer.right - inner.left,
          bottom: outer.bottom - inner.top,
        };
      },
      isEnabled: () => highlighterRef.current,
      onPreview: (rects) => {
        if (!rects) {
          setPreview(null);
          return;
        }
        const contents = renditionRef.current?.getContents?.()?.[0];
        const frame = contents?.document?.defaultView?.frameElement;
        const offset = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
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
      onCommit: ({ range, text, trace }) => {
        const contents = renditionRef.current?.getContents?.()?.[0];
        try {
          const cfiRange = contents?.cfiFromRange(range);
          if (!cfiRange) {
            closeTrace(trace, 'no-cfi', { anchored: false });
            notify('That passage could not be anchored to the book.', 'error');
            return;
          }
          closeTrace(trace, 'highlighted', { anchored: true });
          saveHighlight({ cfiRange, text, color: settingsRef.current.defaultColor });
        } catch (err) {
          console.warn('Could not anchor that highlight', err);
          closeTrace(trace, 'cfi-threw', { anchored: false, error: String(err?.message || err) });
          notify('That passage could not be highlighted.', 'error');
        }
      },
      // A press that never moved is still a mark to erase, a page to turn, or
      // the chrome to show.
      onTap: (x, y) => {
        const mark = markAt(x, y);
        if (mark) {
          tapMark(mark);
          return;
        }
        handleTap(x);
      },
      onMiss: (reason) =>
        notify(
          reason === 'no-text-found'
            ? 'Could not read the text on this page to highlight it.'
            : 'No text under that drag — try across a line.',
          'error',
          onShowDiagnostics && { label: 'Why?', onAct: onShowDiagnostics },
        ),
      /*
       * Two fingers move through the book without putting the pen down. In a
       * paginated book the direction is settled at the end, because a page turn
       * is a single event and cannot follow a finger; a continuously scrolled
       * one is dragged as it goes, which is what scrolling is.
       */
      onPan: ({ phase, dx, dy, stepY }) => {
        if (settingsRef.current.flow === 'scrolled') {
          if (phase !== 'move') return;
          const container = hostRef.current?.querySelector('.epub-container');
          if (container) container.scrollTop -= stepY;
          return;
        }
        if (phase !== 'end') return;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const travel = horizontal ? dx : dy;
        if (Math.abs(travel) < PAN_TURN) return;
        // Left, or up, goes forward: the page moves the way the fingers do.
        turnPage(travel < 0 ? 'next' : 'prev');
      },
      onTrace: (entry) => recordTrace({ ...entry, view: 'epub', flow: settingsRef.current.flow }),
    });

    dragDetachRef.current = detach;
    return () => {
      detach();
      dragDetachRef.current = null;
      setPreview(null);
    };
  }, [
    highlighterOn,
    status,
    handleTap,
    markAt,
    tapMark,
    turnPage,
    closeTrace,
    notify,
    onShowDiagnostics,
    saveHighlight,
  ]);

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
          setLayoutTick((tick) => tick + 1);
        });

        rendition.on('rendered', () => {
          drawnRef.current.clear();
          paintHighlights(true);
          applyMode(highlighterRef.current);
          setLayoutTick((tick) => tick + 1);
          // Count what reaches the frame, whoever ends up acting on it.
          for (const contents of rendition.getContents() || []) {
            const doc = contents?.document;
            if (!doc || witnessedDocs.current.has(doc)) continue;
            witnessedDocs.current.add(doc);
            for (const type of ['click', 'touchstart', 'touchend']) {
              doc.addEventListener(type, () => { witnessRef.current[type] += 1; }, {
                passive: true,
                capture: true,
              });
            }
          }
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
          // While the highlighter is on, a drag across the page is a highlight
          // and nothing else — reading it as a swipe is what used to carry the
          // page away just as the mark was made.
          if (highlighterRef.current) return;
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
          // Taps belong to the highlighter in highlighter mode; it turns the
          // page itself, and letting this fire too turned two at a time.
          if (highlighterRef.current) return;
          // The mark's own handler already dealt with it.
          if (Date.now() - markClickRef.current < 350) return;

          const frame = contents.document?.defaultView?.frameElement;
          const offset = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
          const x = (event.clientX ?? 0) + offset.left;
          const y = (event.clientY ?? 0) + offset.top;

          /*
           * A tap on a highlight should never have got this far — epub.js puts a
           * click handler on the mark itself. But the mark lives in a pane that
           * is pointer-events:none, and WebKit honours that for the whole
           * subtree where Chromium lets the rectangle inside it through. So on
           * iOS the tap falls past the mark, into the frame, and arrives here as
           * an ordinary tap on the page. Measuring the marks answers in either
           * engine, which is why it is done before anything else.
           */
          const mark = markAt(x, y);
          if (mark) {
            tapMarkRef.current(mark);
            return;
          }

          if (contents.window?.getSelection()?.toString().trim()) return;
          if (menuOpenRef.current) {
            closeMenu();
            return;
          }
          handleTap(x);
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

  // Marks are painted by epub.js after a layout it does not announce
  // synchronously, so measure on the next frame rather than in the same one.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const frame = requestAnimationFrame(measureMarks);
    return () => cancelAnimationFrame(frame);
  }, [highlights, status, layoutTick, settings, measureMarks]);

  // In a continuously scrolled book the marks move under the finger, and a
  // target left where a highlight used to be is worse than none at all.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const container = hostRef.current?.querySelector('.epub-container');
    if (!container) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureMarks);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, [status, settings.flow, measureMarks]);

  useEffect(() => {
    const onResize = () => {
      closeMenu();
      paintHighlights(true);
      setLayoutTick((tick) => tick + 1);
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

  /**
   * Runs the whole highlight pipeline on the page in front of you, without
   * anyone touching the screen.
   *
   * A recorded gesture tells you what happened when a finger arrived. This
   * tells you what would happen if one did — which is the other half, and the
   * half that matters when no gesture is being recorded at all. Every step is
   * the same call the drag makes, in the same order, so a failure here is a
   * failure there.
   */
  const selfTest = useCallback(async () => {
    const steps = [];
    const add = (name, ok, detail = '') => steps.push({ name, ok, detail });

    const rendition = renditionRef.current;
    if (!rendition) {
      add('book is rendered', false, 'no rendition yet');
      return steps;
    }
    const contents = rendition.getContents?.() || [];
    add('book is rendered', contents.length > 0, `${contents.length} section document(s)`);
    const content = contents[0];
    const doc = content?.document;
    const frame = doc?.defaultView?.frameElement;
    if (!doc || !frame) {
      add('page reachable from the app', false, 'no iframe document');
      return steps;
    }
    const rect = frame.getBoundingClientRect();
    add('page reachable from the app', true, `frame ${Math.round(rect.width)}×${Math.round(rect.height)}`);

    add('catcher is up', !!catcherRef.current, highlighterOn ? '' : 'highlighter is off');
    add('drag listener bound', !!dragDetachRef.current, highlighterOn ? '' : 'highlighter is off');
    add('page has text', countTextNodes(doc) > 0, `${countTextNodes(doc)} text nodes`);

    const container = frame.closest?.('.epub-container');
    const outer = container?.getBoundingClientRect();
    const box = outer && {
      left: outer.left - rect.left,
      top: outer.top - rect.top,
      right: outer.right - rect.left,
      bottom: outer.bottom - rect.top,
    };
    add('visible page located', !!box, box ? `${Math.round(box.right - box.left)}px wide` : '');

    const tiers = {};
    const index = indexForDrag(doc, box, tiers);
    add('words measured on this page', index.length > 0, `${index.length} words · tiers ${JSON.stringify(tiers)}`);
    if (!index.length) return steps;

    // Two points on one line of real text, which is what a drag across a line
    // would have produced.
    const line = index.filter((word) => Math.abs(word.rect.top - index[0].rect.top) < 2);
    const from = line[0] || index[0];
    const to = line[line.length - 1] || index[Math.min(index.length - 1, 8)];
    const at = (word, edge) => ({
      x: edge === 'end' ? word.rect.right - 1 : word.rect.left + 1,
      y: word.rect.top + word.rect.height / 2,
    });
    const a = at(from, 'start');
    const b = at(to, 'end');

    add('browser caret hit-test', !!caretFromApi(doc, a.x, a.y), 'optional — the word index is the fallback');

    const anchor = caretRangeAt(doc, a.x, a.y, index, box);
    add('start of drag resolved', !!anchor);
    const focus = caretRangeAt(doc, b.x, b.y, index, box);
    add('end of drag resolved', !!focus);
    if (!anchor || !focus) return steps;

    const spanned = rangeBetween(doc, anchor, focus);
    add('range spans the two', !!spanned);
    if (!spanned) return steps;

    const snapped = snapToWords(spanned);
    const text = snapped.toString().replace(/\s+/g, ' ').trim();
    add('range covers text', !!text, text ? `“${text.slice(0, 48)}”` : 'empty');
    add('range has shape on screen', rectsOf(snapped).length > 0, `${rectsOf(snapped).length} rect(s)`);
    if (!text) return steps;

    try {
      const cfi = content.cfiFromRange(snapped);
      add('anchored to the book', !!cfi, cfi || 'cfiFromRange returned nothing');
    } catch (err) {
      add('anchored to the book', false, String(err?.message || err));
    }

    /*
     * The page turn, measured the same way: turn a page for real and watch
     * whether anything moved over time. "The animation is switched off" and
     * "the animation ran and the browser did not paint it" look identical from
     * the sofa and are entirely different faults.
     */
    const heard = witnessRef.current;
    const anyHeard = heard.click + heard.touchstart + heard.touchend > 0;
    add(
      'taps heard inside the page itself',
      anyHeard,
      anyHeard
        ? `click ${heard.click}, touchstart ${heard.touchstart}, touchend ${heard.touchend}`
        : 'none since this book opened — if you have tapped the page, nothing in the frame is ' +
          'heard, and tapping to turn a page cannot work either. Tap the middle of the page a ' +
          'few times, then run this again.',
    );

    const wanted = settingsRef.current.pageAnimation !== false;
    add('page-turn animation switched on', wanted, wanted ? '' : 'turn it on in reading settings');
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    add(
      'system allows motion',
      !reduced,
      reduced ? 'Reduce Motion is on in iOS Accessibility — animations are skipped on purpose' : '',
    );
    add(
      'paginated',
      settingsRef.current.flow === 'paginated',
      settingsRef.current.flow === 'paginated' ? '' : 'continuous scroll has no page turn',
    );

    if (wanted && !reduced && settingsRef.current.flow === 'paginated') {
      const container = hostRef.current?.querySelector('.epub-container');
      const view = container?.firstElementChild;
      if (container && view) {
        const before = container.scrollLeft;
        const seen = new Set();
        const sample = setInterval(() => {
          seen.add(window.getComputedStyle(view).transform || 'none');
        }, 25);
        await turnPage('next');
        clearInterval(sample);
        const turned = container.scrollLeft !== before;
        add('a page actually turned', turned, `scroll ${before} → ${container.scrollLeft}`);
        const frames = [...seen].filter((value) => value && value !== 'none');
        add(
          'the slide was animated',
          frames.length > 1,
          frames.length > 1
            ? `${frames.length} distinct positions`
            : 'the page arrived without moving through anything',
        );
        // Put the reader back where they were.
        await turnPage('prev');
      }
    }
    return steps;
  }, [highlighterOn, turnPage]);

  useImperativeHandle(
    ref,
    () => ({
      next: () => turnPage('next'),
      prev: () => turnPage('prev'),
      goTo: (target) => renditionRef.current?.display(target).catch(() => {}),
      goToHighlight: flashHighlight,
      selfTest,
    }),
    [flashHighlight, turnPage, selfTest],
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

  return (
    <div
      className={highlighterOn ? 'epub-host-wrap is-highlighting' : 'epub-host-wrap'}
      style={{ padding: `2.5% ${settings.margin}%` }}
      /*
       * The margins around the page were dead: a tap there reached neither the
       * frame nor any handler, so reaching for the top of the screen did
       * nothing and the second, lower try landed on the text. They answer the
       * same way the page does now — the strict target check is what keeps this
       * from firing a second time for a tap that already went to the frame or
       * to one of the highlight targets above it.
       */
      onClick={(event) => {
        if (highlighterRef.current) return;
        if (event.target !== event.currentTarget && event.target !== hostRef.current) return;
        handleTap(event.clientX);
      }}
    >
      <div ref={hostRef} className="epub-host" />

      {/*
        Transparent, and above everything, only while the highlighter is on. It
        exists to be the thing the finger lands on, in the top-level document,
        because inside the iframe on iOS the touch was never heard.
      */}
      {highlighterOn && <div ref={catcherRef} className="epub-catcher" />}

      {/*
        One target per highlight, in the top-level document. Only these small
        rectangles take the touch; everywhere else the page is untouched, so
        selecting text still works. While the highlighter is on the catcher above
        already answers for taps, and these would only be in its way.
      */}
      {!highlighterOn &&
        markBoxes.map((box) => (
          <button
            key={box.key}
            type="button"
            className="epub-mark-hit"
            style={{
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
            aria-label="Edit this highlight"
            onClick={() =>
              tapMark({
                id: box.id,
                rect: { left: box.left, top: box.top, width: box.width, height: box.height },
              })
            }
          />
        ))}

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
