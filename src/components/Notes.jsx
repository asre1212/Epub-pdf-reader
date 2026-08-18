import { useMemo, useState } from 'react';
import HighlightCard from './HighlightCard.jsx';
import { HIGHLIGHT_COLORS } from '../lib/highlightColors.js';
import {
  copyToClipboard,
  downloadText,
  highlightsToMarkdown,
  highlightsToText,
} from '../lib/exportNotes.js';

const GROUP_SORTS = [
  { id: 'title', label: 'Book title (A–Z)' },
  { id: 'recent', label: 'Recently read' },
  { id: 'count', label: 'Most highlights' },
];

export default function Notes({
  books,
  highlights,
  onOpenHighlight,
  onEditHighlight,
  onDeleteHighlight,
  notify,
}) {
  const [query, setQuery] = useState('');
  const [colorFilter, setColorFilter] = useState('all');
  const [bookFilter, setBookFilter] = useState('all');
  const [groupSort, setGroupSort] = useState('title');
  const [notesOnly, setNotesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const booksById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const buckets = new Map();

    for (const h of highlights) {
      const book = booksById.get(h.bookId);
      if (!book) continue; // book was deleted mid-render
      if (bookFilter !== 'all' && h.bookId !== bookFilter) continue;
      if (colorFilter !== 'all' && h.color !== colorFilter) continue;
      if (notesOnly && !h.note) continue;
      if (
        needle &&
        !`${h.text} ${h.note || ''} ${book.title} ${book.author || ''}`.toLowerCase().includes(needle)
      ) {
        continue;
      }
      if (!buckets.has(book.id)) buckets.set(book.id, { book, highlights: [] });
      buckets.get(book.id).highlights.push(h);
    }

    const list = [...buckets.values()];
    for (const group of list) {
      group.highlights.sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt,
      );
    }
    list.sort((a, b) => {
      switch (groupSort) {
        case 'recent':
          return (
            (b.book.lastOpenedAt || b.book.addedAt) - (a.book.lastOpenedAt || a.book.addedAt)
          );
        case 'count':
          return b.highlights.length - a.highlights.length;
        default:
          return a.book.title.localeCompare(b.book.title, undefined, { sensitivity: 'base' });
      }
    });
    return list;
  }, [highlights, booksById, query, colorFilter, bookFilter, notesOnly, groupSort]);

  const shown = groups.reduce((sum, group) => sum + group.highlights.length, 0);
  const booksWithHighlights = useMemo(() => {
    const ids = new Set(highlights.map((h) => h.bookId));
    return books
      .filter((b) => ids.has(b.id))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }, [books, highlights]);

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyAll = async () => {
    if (!shown) return;
    const ok = await copyToClipboard(highlightsToMarkdown(groups));
    notify(ok ? `Copied ${shown} highlight${shown === 1 ? '' : 's'}` : 'Could not copy', ok ? 'success' : 'error');
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="screen-head-row">
          <h1>Notes</h1>
          {shown > 0 && (
            <div className="head-actions">
              <button type="button" className="btn" onClick={copyAll}>
                Copy
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(`highlights-${stamp}.md`, highlightsToMarkdown(groups), 'text/markdown')
                }
              >
                .md
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => downloadText(`highlights-${stamp}.txt`, highlightsToText(groups))}
              >
                .txt
              </button>
            </div>
          )}
        </div>

        {highlights.length > 0 && (
          <>
            <div className="screen-head-row screen-head-tools">
              <input
                type="search"
                className="field"
                placeholder="Search highlights and notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="field field-select"
                value={groupSort}
                onChange={(e) => setGroupSort(e.target.value)}
                aria-label="Sort books"
              >
                {GROUP_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="filters">
              <select
                className="field field-select"
                value={bookFilter}
                onChange={(e) => setBookFilter(e.target.value)}
                aria-label="Filter by book"
              >
                <option value="all">All books</option>
                {booksWithHighlights.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>

              <div className="swatch-filter" role="group" aria-label="Filter by colour">
                <button
                  type="button"
                  className={colorFilter === 'all' ? 'swatch swatch-all is-on' : 'swatch swatch-all'}
                  onClick={() => setColorFilter('all')}
                  title="All colours"
                >
                  All
                </button>
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    className={colorFilter === color.id ? 'swatch is-on' : 'swatch'}
                    style={{ '--swatch': color.hex }}
                    onClick={() => setColorFilter(colorFilter === color.id ? 'all' : color.id)}
                    title={color.label}
                    aria-label={color.label}
                    aria-pressed={colorFilter === color.id}
                  />
                ))}
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notesOnly}
                  onChange={(e) => setNotesOnly(e.target.checked)}
                />
                <span>With notes only</span>
              </label>
            </div>
          </>
        )}
      </header>

      {highlights.length === 0 && (
        <div className="empty">
          <h2>No highlights yet</h2>
          <p>
            Open a book, select some text, and pick a colour. Every highlight you make lands here,
            grouped by book, in one notepad you can search, copy, or export.
          </p>
        </div>
      )}

      {highlights.length > 0 && shown === 0 && (
        <p className="muted pad">Nothing matches those filters.</p>
      )}

      {shown > 0 && (
        <div className="notepad">
          <p className="notepad-summary muted small">
            {shown} highlight{shown === 1 ? '' : 's'} across {groups.length} book
            {groups.length === 1 ? '' : 's'}
          </p>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.book.id);
            return (
              <section key={group.book.id} className="note-group">
                <div className="note-group-head">
                  <button
                    type="button"
                    className="note-group-toggle"
                    onClick={() => toggle(group.book.id)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className={isCollapsed ? 'caret' : 'caret caret-open'} aria-hidden="true" />
                    <span className="note-group-title">
                      <strong>{group.book.title}</strong>
                      {group.book.author && <em>{group.book.author}</em>}
                    </span>
                    <span className="note-group-count">{group.highlights.length}</span>
                  </button>
                </div>

                {!isCollapsed && (
                  <ul className="note-list">
                    {group.highlights.map((highlight) => (
                      <HighlightCard
                        key={highlight.id}
                        highlight={highlight}
                        onOpen={() => onOpenHighlight(group.book, highlight)}
                        onChangeColor={(color) => onEditHighlight(highlight.id, { color })}
                        onChangeNote={(note) => onEditHighlight(highlight.id, { note })}
                        onDelete={() => onDeleteHighlight(highlight.id)}
                        onCopy={async () => {
                          const ok = await copyToClipboard(
                            highlight.note
                              ? `“${highlight.text}”\n\n${highlight.note}`
                              : highlight.text,
                          );
                          notify(ok ? 'Copied' : 'Could not copy', ok ? 'success' : 'error');
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
