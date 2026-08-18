import { useLayoutEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS } from '../lib/highlightColors.js';

const GAP = 10;

/**
 * Floating toolbar anchored to a text selection or an existing highlight.
 * `rect` is in viewport coordinates; the toolbar flips below the selection when
 * there is no room above it and is always clamped to the screen.
 */
export default function SelectionMenu({
  rect,
  mode = 'create',
  color,
  onPick,
  onNote,
  onCopy,
  onDelete,
  onClose,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(GAP, left), Math.max(GAP, vw - width - GAP));

    let top = rect.top - height - GAP;
    if (top < GAP) top = rect.top + rect.height + GAP;
    // The anchor can sit off-screen (a highlight scrolled past, a selection that
    // started above the fold), so keep the toolbar itself inside the viewport.
    top = Math.min(Math.max(GAP, top), Math.max(GAP, vh - height - GAP));

    setPos({ left, top });
  }, [rect]);

  return (
    <div
      ref={ref}
      className="selmenu"
      style={{
        left: pos ? `${pos.left}px` : '-9999px',
        top: pos ? `${pos.top}px` : '-9999px',
        visibility: pos ? 'visible' : 'hidden',
      }}
      role="toolbar"
      aria-label={mode === 'create' ? 'Highlight selection' : 'Edit highlight'}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="selmenu-colors">
        {HIGHLIGHT_COLORS.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className={color === swatch.id ? 'swatch swatch-lg is-on' : 'swatch swatch-lg'}
            style={{ '--swatch': swatch.hex }}
            onClick={() => onPick(swatch.id)}
            title={swatch.label}
            aria-label={`${swatch.label} highlight`}
          />
        ))}
      </div>

      <div className="selmenu-actions">
        <button type="button" onClick={onNote}>
          Note
        </button>
        <button type="button" onClick={onCopy}>
          Copy
        </button>
        {mode === 'edit' && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="selmenu-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
    </div>
  );
}
