const LINE_TOLERANCE = 0.006; // fraction of page height
const GAP_TOLERANCE = 0.012; // fraction of page width

/**
 * Turns the per-span rectangles a DOM Range produces into a handful of
 * page-relative line boxes. Coordinates are fractions of the page box so they
 * survive zooming and rotation of the viewport.
 */
export function normalizeSelectionRects(range, pageBoxes) {
  const out = [];
  for (const rect of range.getClientRects()) {
    if (rect.width < 0.6 || rect.height < 0.6) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = pageBoxes.find(
      ({ box }) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom,
    );
    if (!hit) continue;
    const { box, page } = hit;
    out.push({
      p: page,
      x: (rect.left - box.left) / box.width,
      y: (rect.top - box.top) / box.height,
      w: rect.width / box.width,
      h: rect.height / box.height,
    });
  }
  return mergeRects(out);
}

/** Collapses the many per-span boxes on one line into a single run. */
export function mergeRects(rects) {
  const byPage = new Map();
  for (const rect of rects) {
    if (!byPage.has(rect.p)) byPage.set(rect.p, []);
    byPage.get(rect.p).push(rect);
  }

  const merged = [];
  for (const [page, list] of byPage) {
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const rect of list) {
      const line = lines.find(
        (candidate) =>
          Math.abs(candidate.y - rect.y) < LINE_TOLERANCE &&
          Math.abs(candidate.h - rect.h) < LINE_TOLERANCE * 2,
      );
      if (line) line.parts.push(rect);
      else lines.push({ y: rect.y, h: rect.h, parts: [rect] });
    }

    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x);
      let current = null;
      for (const part of line.parts) {
        if (current && part.x <= current.x + current.w + GAP_TOLERANCE) {
          const right = Math.max(current.x + current.w, part.x + part.w);
          current.w = right - current.x;
          current.y = Math.min(current.y, part.y);
          current.h = Math.max(current.h, part.h);
        } else {
          current = { p: page, x: part.x, y: part.y, w: part.w, h: part.h };
          merged.push(current);
        }
      }
    }
  }
  merged.sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
  return merged;
}

/** True when a page-relative point falls inside any of the highlight's boxes. */
export function hitTest(highlight, page, x, y, pad = 0.004) {
  return (highlight.rects || []).some(
    (rect) =>
      rect.p === page &&
      x >= rect.x - pad &&
      x <= rect.x + rect.w + pad &&
      y >= rect.y - pad &&
      y <= rect.y + rect.h + pad,
  );
}
