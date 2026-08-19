/**
 * Drag-to-highlight.
 *
 * Touch text selection is the weak point of highlighting in a reader: on iOS it
 * means a long press, a magnifier and two drag handles, and inside epub.js's
 * sandboxed iframe the selection events that go with it are unreliable. So this
 * does not use the native selection. It hit-tests a caret position under the
 * finger on the way down, again on every move, and builds the Range itself.
 *
 * Two things here exist specifically because of WebKit:
 *
 *  - The content is NOT given `user-select: none`. WebKit ties caret
 *    hit-testing to selectability, so `caretRangeFromPoint` returns null inside
 *    unselectable text and the whole gesture silently does nothing. Chromium
 *    does not care, which is exactly why this was easy to get wrong. iOS's own
 *    selection UI is suppressed by preventing the default on the touch instead.
 *  - The gesture is tracked with Touch events rather than Pointer events, which
 *    have a patchy history inside iframes on iOS.
 *
 * It also takes the gesture rather than sharing it. While a drag is running the
 * events are stopped where they are caught, so nothing downstream — epub.js's
 * swipe-to-turn above all — gets a second reading of the same finger.
 */

const WORD = /[\p{L}\p{N}'’-]/u;
const DRAG_SLOP = 6; // px of movement before a press becomes a drag

/** The caret position under a point, across the two spellings of the API. */
function caretFromApi(doc, x, y) {
  try {
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (!pos?.offsetNode) return null;
      const range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
  } catch {
    /* outside any text, or a node we cannot address */
  }
  return null;
}

/** The whole of `doc`'s own viewport, used when nothing narrower is offered. */
function fullViewport(doc) {
  const view = doc.defaultView;
  if (!view) return null;
  return { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight };
}

function intersects(rect, box, margin = 0) {
  return (
    rect.right >= box.left - margin &&
    rect.left <= box.right + margin &&
    rect.bottom >= box.top - margin &&
    rect.top <= box.bottom + margin
  );
}

/**
 * A map of every word on the page to where it sits on screen.
 *
 * This is the fallback when the caret APIs refuse, and it deliberately uses no
 * hit-testing API at all — not `caretRangeFromPoint`, not `elementFromPoint`.
 * Inside epub.js's iframe on WebKit those return nothing, which left dragging
 * dead with no way to recover. Measured `Range` geometry always works.
 *
 * `box` is the slice of the document the reader can actually see, in the same
 * coordinates as a touch inside it. It matters more than it looks: epub.js
 * stretches its iframe to hold *every* column of a chapter and then scrolls the
 * container over it, so the document is many pages wide and "in the iframe" is
 * nothing like "on the page". Without the box, the nearest word to a finger near
 * the edge of the page can be one in the next column, off-screen — a highlight
 * over text the reader never saw. Built once per drag: nothing can scroll while
 * the highlighter owns the gesture, so the rectangles stay true.
 */
function buildWordIndex(doc, box) {
  const view = doc.defaultView;
  if (!doc.body || !view) return [];
  const words = [];
  const probe = doc.createRange();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node;

  while ((node = walker.nextNode())) {
    const text = node.data;
    if (!text.trim()) continue;

    probe.selectNodeContents(node);
    const bounds = probe.getBoundingClientRect();
    if (!bounds.width && !bounds.height) continue;
    // A paragraph flowing across columns reports one union rectangle spanning
    // all of them, so this only rejects text nowhere near the page; the
    // per-word rectangles below are what actually decide.
    if (!intersects(bounds, box, 160)) continue;

    for (let i = 0; i < text.length; ) {
      while (i < text.length && !WORD.test(text[i])) i += 1;
      if (i >= text.length) break;
      let end = i;
      while (end < text.length && WORD.test(text[end])) end += 1;

      probe.setStart(node, i);
      probe.setEnd(node, end);
      for (const rect of probe.getClientRects()) {
        if (!rect.width && !rect.height) continue;
        if (!intersects(rect, box)) continue;
        words.push({ node, start: i, end, rect });
      }
      i = end;
    }
  }
  return words;
}

/**
 * The word index for a drag: the visible page first, the whole document as a
 * last resort. Coming back empty is what produces "could not read this page",
 * so the fallback is worth the extra pass — a highlight anchored oddly beats a
 * gesture that does nothing.
 */
function indexForDrag(doc, box, tiers = {}) {
  const viewport = fullViewport(doc);
  const page = box || viewport;
  if (page) {
    const words = buildWordIndex(doc, page);
    tiers.page = words.length;
    if (words.length) return words;
  }
  if (viewport && page !== viewport) {
    const words = buildWordIndex(doc, viewport);
    tiers.viewport = words.length;
    if (words.length) return words;
  }
  const words = buildWordIndex(doc, {
    left: -Infinity,
    top: -Infinity,
    right: Infinity,
    bottom: Infinity,
  });
  tiers.all = words.length;
  return words;
}

/** How many text nodes the page has at all — zero means there was nothing to read. */
function countTextNodes(doc) {
  if (!doc.body) return 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) count += 1;
  return count;
}

/**
 * Whatever the browser selected on its own during the gesture.
 *
 * On iOS the system may run its own selection underneath ours however firmly we
 * decline it. If our own hit-testing came back with nothing, that selection is
 * the reader's intent expressed through a different mechanism, and throwing it
 * away to report a failure would be perverse.
 */
function nativeSelectionRange(doc) {
  try {
    const selection = doc.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return range.toString().trim() ? range : null;
  } catch {
    return null;
  }
}

/** Distance from a point to a rectangle, zero when inside it. */
function distanceTo(rect, x, y) {
  const dx = x - Math.min(Math.max(x, rect.left), rect.right);
  const dy = y - Math.min(Math.max(y, rect.top), rect.bottom);
  // Weight vertical distance: the nearest word on this line beats a closer one
  // on the line above.
  return dx * dx + dy * dy * 4;
}

function caretFromIndex(doc, index, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const word of index) {
    const distance = distanceTo(word.rect, x, y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = word;
    }
  }
  if (!best) return null;
  const range = doc.createRange();
  // Snap to whichever end of the word the finger is nearer.
  const after = x > best.rect.left + best.rect.width / 2;
  range.setStart(best.node, after ? best.end : best.start);
  range.collapse(true);
  return range;
}

/** Is this caret somewhere the reader can actually see? */
function caretIsVisible(range, box) {
  if (!box) return true;
  try {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height && !rect.left && !rect.top) return true;
    return intersects(rect, box, 4);
  } catch {
    return true;
  }
}

/**
 * The caret under a point. The browser's own hit-test comes first, but its
 * answer is only trusted when it lands on the visible page: asked about a point
 * in the gutter between columns it will happily return a caret in the next
 * column, which is off-screen. The measured word index is both the fallback for
 * when the API refuses and the correction for when it overreaches.
 */
export function caretRangeAt(doc, x, y, index, box) {
  const api = caretFromApi(doc, x, y);
  if (api && caretIsVisible(api, box)) return api;
  const measured = index ? caretFromIndex(doc, index, x, y) : null;
  return measured || api || null;
}

/** A Range spanning two collapsed carets, whichever order they were made in. */
export function rangeBetween(doc, a, b) {
  try {
    // 0 is Range.START_TO_START; the constant is not on instances everywhere.
    const aFirst = a.compareBoundaryPoints(0, b) <= 0;
    const first = aFirst ? a : b;
    const last = aFirst ? b : a;
    const range = doc.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.startContainer, last.startOffset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

/** Grows a range out to whole words, so a highlight never stops mid-word. */
export function snapToWords(range) {
  const { startContainer, endContainer } = range;
  try {
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.data;
      let start = range.startOffset;
      while (start > 0 && WORD.test(text[start - 1])) start -= 1;
      range.setStart(startContainer, start);
    }
    if (endContainer.nodeType === Node.TEXT_NODE) {
      const text = endContainer.data;
      let end = range.endOffset;
      while (end < text.length && WORD.test(text[end])) end += 1;
      range.setEnd(endContainer, end);
    }
  } catch {
    /* keep the unsnapped range */
  }
  return range;
}

export function rectsOf(range) {
  return [...range.getClientRects()].filter((r) => r.width > 0.4 && r.height > 0.4);
}

/**
 * Listens for a drag across text and reports the range it covers.
 *
 * `onPreview` fires continuously with client rects in `doc`'s own coordinates;
 * `onCommit` fires once on release. A press that never moves goes to `onTap`, so
 * page-turn taps keep working. A drag that covered no text goes to `onMiss`,
 * because silence is the worst possible feedback for a gesture.
 *
 * Returns a function that detaches everything.
 */
export function attachDragHighlighter({
  doc,
  isEnabled,
  containerFor,
  visibleBox,
  onPreview,
  onCommit,
  onTap,
  onMiss,
  onTrace,
}) {
  let anchor = null;
  let origin = null;
  let latest = null;
  let dragging = false;
  let active = false;
  let index = null;
  let box = null;
  let handledAt = 0; // when the highlighter last finished a gesture
  let trace = null;

  const reset = () => {
    anchor = null;
    origin = null;
    latest = null;
    dragging = false;
    active = false;
    index = null;
    box = null;
  };

  const clearNativeSelection = () => {
    try {
      doc.getSelection?.()?.removeAllRanges();
    } catch {
      /* nothing selected */
    }
  };

  const begin = (x, y, target, pointer) => {
    if (!isEnabled()) return false;
    if (containerFor && !containerFor(target)) return false;
    // Measured once per drag; the page cannot move while we hold the gesture.
    box = visibleBox?.() || fullViewport(doc);
    const tiers = {};
    index = indexForDrag(doc, box, tiers);
    trace = {
      pointer,
      events: { start: 1, move: 0, end: 0, cancelable: null },
      index: tiers,
      doc: {
        innerWidth: doc.defaultView?.innerWidth,
        innerHeight: doc.defaultView?.innerHeight,
        frameWidth: doc.defaultView?.frameElement?.getBoundingClientRect?.().width ?? 0,
        frameHeight: doc.defaultView?.frameElement?.getBoundingClientRect?.().height ?? 0,
        textNodes: countTextNodes(doc),
      },
      stage: {
        box: box
          ? `${Math.round(box.left)},${Math.round(box.top)} → ${Math.round(box.right)},${Math.round(box.bottom)}`
          : 'none',
      },
      caretApi: !!(doc.caretRangeFromPoint || doc.caretPositionFromPoint),
      caretApiHit: !!caretFromApi(doc, x, y),
    };
    anchor = caretRangeAt(doc, x, y, index, box);
    origin = { x, y };
    latest = null;
    dragging = false;
    active = true;
    clearNativeSelection();
    return true;
  };

  const move = (x, y) => {
    if (!active) return false;
    if (trace) trace.events.move += 1;
    if (!dragging && Math.hypot(x - origin.x, y - origin.y) < DRAG_SLOP) return false;
    dragging = true;
    // The caret may not have resolved at touch-down — over a margin, say — so
    // keep trying until the finger reaches something addressable.
    if (!anchor) {
      anchor =
        caretRangeAt(doc, origin.x, origin.y, index, box) || caretRangeAt(doc, x, y, index, box);
    }
    if (!anchor) return true;

    const focus = caretRangeAt(doc, x, y, index, box);
    if (!focus) return true;
    const range = rangeBetween(doc, anchor, focus);
    if (!range) return true;
    latest = snapToWords(range);
    onPreview(rectsOf(latest));
    return true;
  };

  const finish = (x, y) => {
    if (!active) return;
    handledAt = Date.now();
    const wasDragging = dragging;
    const start = origin;
    const report = trace;
    let range = latest;
    let focus = null;

    if (wasDragging && anchor && Number.isFinite(x)) {
      focus = caretRangeAt(doc, x, y, index, box);
      const fresh = focus && rangeBetween(doc, anchor, focus);
      if (fresh) range = snapToWords(fresh);
    }

    // Last resort: if our own reading of the page produced nothing but the
    // browser selected something anyway, take the browser's answer.
    const native = range ? null : nativeSelectionRange(doc);
    if (native) range = snapToWords(native);

    // Why it failed, if it did — the difference between "we could not read the
    // page" and "you dragged across a margin" is the whole diagnosis.
    const reason = !index?.length ? 'no-text-found' : !anchor ? 'no-anchor' : 'empty-range';
    const text = range?.toString().replace(/\s+/g, ' ').trim();

    if (report) {
      report.events.end = 1;
      report.anchor = !!anchor;
      report.focus = !!focus;
      report.textLength = text?.length || 0;
      report.text = text ? text.slice(0, 60) : '';
      if (native) report.nativeSelection = `used, ${text?.length || 0} chars`;
    }

    reset();
    trace = null;
    onPreview(null);
    clearNativeSelection();

    if (!wasDragging) {
      if (report) emitTrace(report, 'tap');
      onTap?.(start.x, start.y);
      return;
    }
    if (range && text) {
      // `anchored` is filled in by onCommit: a range can be perfect and still
      // fail to become a highlight, and those are different bugs.
      onCommit({ range, text, trace: report });
      if (report && report.outcome === undefined) emitTrace(report, 'highlighted');
    } else {
      if (report) emitTrace(report, 'missed', reason);
      onMiss?.(reason);
    }
  };

  const emitTrace = (report, outcome, reason) => {
    if (!onTrace || report.outcome !== undefined) return;
    report.outcome = outcome;
    if (reason) report.reason = reason;
    onTrace(report);
  };

  const cancel = () => {
    reset();
    onPreview(null);
  };

  /* ------------------------------------------------------------ touch path */

  /**
   * Take the gesture off everyone else.
   *
   * `preventDefault` alone is not enough. It stops the browser scrolling and
   * selecting, but every other listener still runs — and in the EPUB view those
   * belong to epub.js, which reads the same drag as a swipe and turns the page.
   * That is what made highlighting look broken: the mark was made and then the
   * page it was on slid away. Claiming the gesture outright is the fix.
   */
  const claim = (event) => {
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
  };

  const onTouchStart = (event) => {
    if (event.touches.length > 1) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    if (!begin(touch.clientX, touch.clientY, event.target, 'touch')) return;
    // Stops iOS starting its own selection, magnifier and callout. The content
    // stays selectable so caret hit-testing keeps working. Whether the touch was
    // cancelable at all is worth knowing: if it was not, iOS kept the gesture.
    if (trace) trace.events.cancelable = event.cancelable;
    claim(event);
  };

  const onTouchMove = (event) => {
    if (!active) return;
    if (event.touches.length > 1) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    move(touch.clientX, touch.clientY);
    claim(event);
  };

  const onTouchEnd = (event) => {
    if (!active) return;
    const touch = event.changedTouches[0];
    claim(event);
    finish(touch?.clientX, touch?.clientY);
  };

  /* ------------------------------------------------------------ mouse path */

  const onMouseDown = (event) => {
    if (event.button !== 0) return;
    if (begin(event.clientX, event.clientY, event.target, 'mouse')) claim(event);
  };

  const onMouseMove = (event) => {
    if (!active) return;
    move(event.clientX, event.clientY);
    claim(event);
  };

  const onMouseUp = (event) => {
    if (!active) return;
    claim(event);
    finish(event.clientX, event.clientY);
  };

  // A press that the highlighter handled must not also arrive as a click: in a
  // paginated book that second life is a page turn.
  const onClick = (event) => {
    // A touch whose default was prevented never produces a click at all, so
    // this expires on time rather than on the click that may never come.
    if (Date.now() - handledAt > 700) return;
    // Only inside the readable area: a quick tap on the toolbar right after a
    // highlight is a different intent and has to land.
    if (containerFor && !containerFor(event.target)) return;
    handledAt = 0;
    event.stopPropagation();
    event.preventDefault();
  };

  const capture = true;
  const active_ = { passive: false, capture: true };

  doc.addEventListener('touchstart', onTouchStart, active_);
  doc.addEventListener('touchmove', onTouchMove, active_);
  doc.addEventListener('touchend', onTouchEnd, active_);
  doc.addEventListener('touchcancel', cancel, capture);
  doc.addEventListener('mousedown', onMouseDown, active_);
  doc.addEventListener('mousemove', onMouseMove, active_);
  doc.addEventListener('mouseup', onMouseUp, active_);
  doc.addEventListener('click', onClick, active_);

  return () => {
    doc.removeEventListener('touchstart', onTouchStart, active_);
    doc.removeEventListener('touchmove', onTouchMove, active_);
    doc.removeEventListener('touchend', onTouchEnd, active_);
    doc.removeEventListener('touchcancel', cancel, capture);
    doc.removeEventListener('mousedown', onMouseDown, active_);
    doc.removeEventListener('mousemove', onMouseMove, active_);
    doc.removeEventListener('mouseup', onMouseUp, active_);
    doc.removeEventListener('click', onClick, active_);
    reset();
  };
}

/**
 * CSS injected into readable content while the highlighter is on.
 *
 * Note what is absent: `user-select: none`. WebKit will not hit-test a caret
 * inside unselectable text, so adding it here stops the gesture dead on iOS
 * while looking perfectly fine in Chromium. The native selection UI is held off
 * by preventing the default on the touch instead.
 */
export const HIGHLIGHTER_CSS = `
  html, body {
    touch-action: none !important;
    cursor: crosshair !important;
  }
  html, body, p, li, div, span, td, th, blockquote, h1, h2, h3, h4, h5, h6, a, img {
    -webkit-touch-callout: none !important;
  }
  ::selection { background: transparent !important; }
  ::-moz-selection { background: transparent !important; }
`;
