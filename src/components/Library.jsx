import { useEffect, useMemo, useRef, useState } from 'react';
import Cover from './Cover.jsx';
import { ACCEPTED_TYPES } from '../lib/importBook.js';
import { estimateUsage } from '../lib/db.js';

const SORTS = [
  { id: 'recent', label: 'Recently read' },
  { id: 'added', label: 'Recently added' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
];

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function Library({
  books,
  highlightCounts,
  importing,
  onImport,
  onOpen,
  onDelete,
  onRename,
  onOpenAbout,
  updateReady,
}) {
  const fileInput = useRef(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [menuFor, setMenuFor] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    estimateUsage().then(setUsage);
  }, [books]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menuFor]);

  const visible = useMemo(() => {
    if (!books) return null;
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? books.filter((b) =>
          `${b.title} ${b.author} ${b.fileName}`.toLowerCase().includes(needle),
        )
      : books;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'title':
          return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        case 'author':
          return (a.author || '￿').localeCompare(b.author || '￿', undefined, {
            sensitivity: 'base',
          });
        case 'added':
          return b.addedAt - a.addedAt;
        default:
          return (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt);
      }
    });
    return sorted;
  }, [books, query, sort]);

  const pick = () => fileInput.current?.click();

  const rename = (book) => {
    setMenuFor(null);
    const next = window.prompt('Book title', book.title);
    if (next && next.trim() && next.trim() !== book.title) onRename(book, next.trim());
  };

  const confirmDelete = (book) => {
    setMenuFor(null);
    const count = highlightCounts.get(book.id) || 0;
    const warning = count
      ? `Delete “${book.title}” and its ${count} highlight${count === 1 ? '' : 's'}?`
      : `Delete “${book.title}”?`;
    if (window.confirm(warning)) onDelete(book);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="screen-head-row">
          <h1>Library</h1>
          <div className="head-actions">
            <button
              type="button"
              className={updateReady ? 'icon-btn icon-btn-bare has-badge' : 'icon-btn icon-btn-bare'}
              onClick={onOpenAbout}
              aria-label={updateReady ? 'About and updates — a new version is ready' : 'About and updates'}
              title="About and updates"
            >
              <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path
                  d="M12 10.6v5.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="7.9" r="1.05" fill="currentColor" />
              </svg>
            </button>
            <button type="button" className="btn btn-primary" onClick={pick} disabled={importing}>
              {importing ? 'Importing…' : 'Add book'}
            </button>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          hidden
          onChange={(e) => {
            onImport(e.target.files);
            e.target.value = '';
          }}
        />
        {books?.length > 0 && (
          <div className="screen-head-row screen-head-tools">
            <input
              type="search"
              className="field"
              placeholder="Search title or author"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="field field-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort books"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {visible === null && <p className="muted pad">Loading…</p>}

      {visible?.length === 0 && books?.length === 0 && (
        <div className="empty">
          <div className="empty-art" aria-hidden="true">
            <Cover book={{ title: 'Your next book', format: 'epub' }} />
          </div>
          <h2>Your library is empty</h2>
          <p>
            Add an EPUB or PDF from Files, iCloud Drive, Google Drive, or anywhere else your file
            picker can reach. Books are stored on this device and stay readable offline.
          </p>
          <button type="button" className="btn btn-primary btn-lg" onClick={pick}>
            Import from Files
          </button>
          <p className="empty-hint">You can also drag files onto this window, or share a book to the app.</p>
        </div>
      )}

      {visible?.length === 0 && books?.length > 0 && (
        <p className="muted pad">No books match “{query}”.</p>
      )}

      {visible?.length > 0 && (
        <ul className="grid">
          {visible.map((book) => {
            const count = highlightCounts.get(book.id) || 0;
            const percent = Math.round((book.progress || 0) * 100);
            return (
              <li key={book.id} className="card">
                <button type="button" className="card-open" onClick={() => onOpen(book)}>
                  <span className="card-cover">
                    <Cover book={book} />
                    {percent > 0 && (
                      <span className="card-progress" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, percent)}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="card-title">{book.title}</span>
                  {book.author && <span className="card-author">{book.author}</span>}
                  <span className="card-meta">
                    <span className={`chip chip-${book.format}`}>{book.format.toUpperCase()}</span>
                    {book.missingFile && (
                      <span className="chip chip-warn" title="Restored from a backup — import the file to read it">
                        NOTES ONLY
                      </span>
                    )}
                    {percent > 0 && <span>{percent}%</span>}
                    {count > 0 && (
                      <span>
                        {count} highlight{count === 1 ? '' : 's'}
                      </span>
                    )}
                    <span className="muted">{formatSize(book.size)}</span>
                  </span>
                </button>

                <button
                  type="button"
                  className="card-menu"
                  aria-label={`More actions for ${book.title}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setMenuFor(menuFor === book.id ? null : book.id)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <circle cx="12" cy="5" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="19" r="1.8" fill="currentColor" />
                  </svg>
                </button>

                {menuFor === book.id && (
                  <div className="popmenu" onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => rename(book)}>
                      Rename
                    </button>
                    <button type="button" className="danger" onClick={() => confirmDelete(book)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {usage?.usage > 0 && books?.length > 0 && (
        <p className="muted pad small">
          {formatSize(usage.usage)} stored on this device
          {usage.quota ? ` of about ${formatSize(usage.quota)} available` : ''}.
        </p>
      )}
    </div>
  );
}
