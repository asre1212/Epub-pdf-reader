/**
 * Drag-to-highlight.
 *
 * Touch text selection is the weak point of highlighting in a reader: on iOS it
 * means a long press, a magnifier and two drag handles, and inside epub.js's
 * sandboxed iframe the selection events that go with it are unreliable. So this
 * does not use the native selection at all. It hit-tests a caret position under
 * the finger on the way down, again on every move, and builds the Range itself —
 * which behaves the same in every engine.
 */

const WORD = /[\p{L}\p{N}'’-]/u;
const DRAG_SLOP = 6; // px of movement before a press becomes a drag

/** The caret position under a point, across the two spellings of the API. */
export function caretRangeAt(doc, x, y) {
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

/**
 * Grows a range out to whole words, so a highlight never stops mid-word however
 * roughly it was drawn.
 */
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
 * `onCommit` fires once on release. A press that never moves is reported through
 * `onTap` instead, so page-turn taps still work while the highlighter is on.
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
}) {
  let anchor = null;
  let origin = null;
  let latest = null;
  let dragging = false;
  let pointerId = null;

  const reset = () => {
    anchor = null;
    origin = null;
    latest = null;
    dragging = false;
    pointerId = null;
  };

  const onPointerDown = (event) => {
    if (!isEnabled()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (containerFor && !containerFor(event.target)) return;

    anchor = caretRangeAt(doc, event.clientX, event.clientY);
    if (!anchor) return;
    origin = { x: event.clientX, y: event.clientY };
    latest = null;
    dragging = false;
    pointerId = event.pointerId ?? 'single';
    // Any leftover native selection would otherwise sit under the drag.
    doc.getSelection?.()?.removeAllRanges();
  };

  const onPointerMove = (event) => {
    if (!anchor || (event.pointerId ?? 'single') !== pointerId) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (!dragging && Math.hypot(dx, dy) < DRAG_SLOP) return;
    dragging = true;

    // Claim the gesture: without this the page scrolls or iOS starts its own
    // selection instead. Requires a non-passive listener.
    if (event.cancelable) event.preventDefault();

    const focus = caretRangeAt(doc, event.clientX, event.clientY);
    if (!focus) return;
    const range = rangeBetween(doc, anchor, focus);
    if (!range) return;
    latest = snapToWords(range);
    onPreview(rectsOf(latest));
  };

  const finish = (event) => {
    if (!anchor || (event.pointerId ?? 'single') !== pointerId) return;
    const wasDragging = dragging;
    const point = origin;
    let range = latest;

    if (wasDragging && event.clientX != null) {
      const focus = caretRangeAt(doc, event.clientX, event.clientY);
      const fresh = focus && rangeBetween(doc, anchor, focus);
      if (fresh) range = snapToWords(fresh);
    }
    reset();
    onPreview(null);

    if (!wasDragging) {
      onTap?.(point.x, point.y);
      return;
    }
    const text = range?.toString().replace(/\s+/g, ' ').trim();
    if (range && text) onCommit({ range, text });
  };

  const onPointerCancel = () => {
    reset();
    onPreview(null);
  };

  // Non-passive so the move handler can keep the page from scrolling.
  const moveOpts = { passive: false };
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointermove', onPointerMove, moveOpts);
  doc.addEventListener('pointerup', finish, true);
  doc.addEventListener('pointercancel', onPointerCancel, true);

  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointermove', onPointerMove, moveOpts);
    doc.removeEventListener('pointerup', finish, true);
    doc.removeEventListener('pointercancel', onPointerCancel, true);
    reset();
  };
}

/** CSS injected into readable content while the highlighter is on. */
export const HIGHLIGHTER_CSS = `
  html, body, p, li, div, span, td, th, blockquote, h1, h2, h3, h4, h5, h6, a {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }
  html, body {
    touch-action: none !important;
    cursor: crosshair !important;
  }
`;
