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

/**
 * A map of every visible word to where it sits on screen.
 *
 * This is the fallback when the caret APIs refuse, and it deliberately uses no
 * hit-testing API at all — not `caretRangeFromPoint`, not `elementFromPoint`.
 * Inside epub.js's iframe on WebKit those return nothing, which left dragging
 * dead with no way to recover. Measured `Range` geometry always works.
 *
 * Only text within the viewport is measured, so in a paginated book this is the
 * page in front of you rather than the chapter. Built once per drag: nothing can
 * scroll while the highlighter owns the gesture, so the rectangles stay true.
 */
function buildWordIndex(doc) {
  const view = doc.defaultView;
  if (!doc.body || !view) return [];
  const width = view.innerWidth;
  const height = view.innerHeight;
  const margin = 120;
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
    if (bounds.bottom < -margin || bounds.top > height + margin) continue;
    if (bounds.right < -margin || bounds.left > width + margin) continue;

    for (let i = 0; i < text.length; ) {
      while (i < text.length && !WORD.test(text[i])) i += 1;
      if (i >= text.length) break;
      let end = i;
      while (end < text.length && WORD.test(text[end])) end += 1;

      probe.setStart(node, i);
      probe.setEnd(node, end);
      for (const rect of probe.getClientRects()) {
        if (rect.width || rect.height) words.push({ node, start: i, end, rect });
      }
      i = end;
    }
  }
  return words;
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

export function caretRangeAt(doc, x, y, index) {
  return caretFromApi(doc, x, y) || (index ? caretFromIndex(doc, index, x, y) : null);
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
  onPreview,
  onCommit,
  onTap,
  onMiss,
}) {
  let anchor = null;
  let origin = null;
  let latest = null;
  let dragging = false;
  let active = false;
  let index = null;

  const reset = () => {
    anchor = null;
    origin = null;
    latest = null;
    dragging = false;
    active = false;
    index = null;
  };

  const clearNativeSelection = () => {
    try {
      doc.getSelection?.()?.removeAllRanges();
    } catch {
      /* nothing selected */
    }
  };

  const begin = (x, y, target) => {
    if (!isEnabled()) return false;
    if (containerFor && !containerFor(target)) return false;
    // Measured once per drag; the page cannot move while we hold the gesture.
    index = buildWordIndex(doc);
    anchor = caretRangeAt(doc, x, y, index);
    origin = { x, y };
    latest = null;
    dragging = false;
    active = true;
    clearNativeSelection();
    return true;
  };

  const move = (x, y) => {
    if (!active) return false;
    if (!dragging && Math.hypot(x - origin.x, y - origin.y) < DRAG_SLOP) return false;
    dragging = true;
    // The caret may not have resolved at touch-down — over a margin, say — so
    // keep trying until the finger reaches something addressable.
    if (!anchor) {
      anchor = caretRangeAt(doc, origin.x, origin.y, index) || caretRangeAt(doc, x, y, index);
    }
    if (!anchor) return true;

    const focus = caretRangeAt(doc, x, y, index);
    if (!focus) return true;
    const range = rangeBetween(doc, anchor, focus);
    if (!range) return true;
    latest = snapToWords(range);
    onPreview(rectsOf(latest));
    return true;
  };

  const finish = (x, y) => {
    if (!active) return;
    const wasDragging = dragging;
    const start = origin;
    let range = latest;

    if (wasDragging && anchor && Number.isFinite(x)) {
      const focus = caretRangeAt(doc, x, y, index);
      const fresh = focus && rangeBetween(doc, anchor, focus);
      if (fresh) range = snapToWords(fresh);
    }
    // Why it failed, if it did — the difference between "we could not read the
    // page" and "you dragged across a margin" is the whole diagnosis.
    const reason = !index?.length ? 'no-text-found' : !anchor ? 'no-anchor' : 'empty-range';
    reset();
    onPreview(null);
    clearNativeSelection();

    if (!wasDragging) {
      onTap?.(start.x, start.y);
      return;
    }
    const text = range?.toString().replace(/\s+/g, ' ').trim();
    if (range && text) onCommit({ range, text });
    else onMiss?.(reason);
  };

  const cancel = () => {
    reset();
    onPreview(null);
  };

  /* ------------------------------------------------------------ touch path */

  const onTouchStart = (event) => {
    if (event.touches.length > 1) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    if (!begin(touch.clientX, touch.clientY, event.target)) return;
    // Stops iOS starting its own selection, magnifier and callout. The content
    // stays selectable so caret hit-testing keeps working.
    if (event.cancelable) event.preventDefault();
  };

  const onTouchMove = (event) => {
    if (!active) return;
    if (event.touches.length > 1) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    if (move(touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
  };

  const onTouchEnd = (event) => {
    if (!active) return;
    const touch = event.changedTouches[0];
    if (event.cancelable) event.preventDefault();
    finish(touch?.clientX, touch?.clientY);
  };

  /* ------------------------------------------------------------ mouse path */

  const onMouseDown = (event) => {
    if (event.button !== 0) return;
    if (begin(event.clientX, event.clientY, event.target)) event.preventDefault();
  };

  const onMouseMove = (event) => {
    if (move(event.clientX, event.clientY)) event.preventDefault();
  };

  const onMouseUp = (event) => finish(event.clientX, event.clientY);

  const capture = true;
  const active_ = { passive: false, capture: true };

  doc.addEventListener('touchstart', onTouchStart, active_);
  doc.addEventListener('touchmove', onTouchMove, active_);
  doc.addEventListener('touchend', onTouchEnd, active_);
  doc.addEventListener('touchcancel', cancel, capture);
  doc.addEventListener('mousedown', onMouseDown, active_);
  doc.addEventListener('mousemove', onMouseMove, active_);
  doc.addEventListener('mouseup', onMouseUp, capture);

  return () => {
    doc.removeEventListener('touchstart', onTouchStart, active_);
    doc.removeEventListener('touchmove', onTouchMove, active_);
    doc.removeEventListener('touchend', onTouchEnd, active_);
    doc.removeEventListener('touchcancel', cancel, capture);
    doc.removeEventListener('mousedown', onMouseDown, active_);
    doc.removeEventListener('mousemove', onMouseMove, active_);
    doc.removeEventListener('mouseup', onMouseUp, capture);
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
