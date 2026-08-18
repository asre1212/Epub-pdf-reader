import { useState } from 'react';
import { colorHex } from '../lib/highlightColors.js';

/** Side drawer with the book's contents and its highlights in reading order. */
export default function TocDrawer({ toc, highlights, format, onGo, onGoHighlight, onClose }) {
  const [pane, setPane] = useState('contents');

  const ordered = [...highlights].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt,
  );

  return (
    <div className="drawer-backdrop" onPointerDown={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Contents"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'contents'}
            className={pane === 'contents' ? 'drawer-tab is-on' : 'drawer-tab'}
            onClick={() => setPane('contents')}
          >
            Contents
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'highlights'}
            className={pane === 'highlights' ? 'drawer-tab is-on' : 'drawer-tab'}
            onClick={() => setPane('highlights')}
          >
            Highlights {highlights.length > 0 && <em>{highlights.length}</em>}
          </button>
        </div>

        {pane === 'contents' && (
          <nav className="drawer-body">
            {toc?.length ? (
              <ul className="toc">
                {toc.map((item) => (
                  <li key={item.id} style={{ '--depth': item.depth }}>
                    <button type="button" onClick={() => onGo(item.href)}>
                      {item.label?.trim() || 'Untitled section'}
                      {format === 'pdf' && <em>p. {item.href}</em>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted pad">This book has no table of contents.</p>
            )}
          </nav>
        )}

        {pane === 'highlights' && (
          <div className="drawer-body">
            {ordered.length ? (
              <ul className="drawer-highlights">
                {ordered.map((highlight) => (
                  <li key={highlight.id} style={{ '--note-color': colorHex(highlight.color) }}>
                    <button type="button" onClick={() => onGoHighlight(highlight.id)}>
                      <span className="drawer-highlight-text">{highlight.text}</span>
                      <span className="drawer-highlight-where">
                        {highlight.format === 'pdf'
                          ? `Page ${highlight.page}`
                          : highlight.chapter || ''}
                      </span>
                      {highlight.note && <span className="drawer-highlight-note">{highlight.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted pad">
                Select text while reading and pick a colour — your highlights collect here and in the
                Notes tab.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
