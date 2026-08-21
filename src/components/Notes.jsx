import { useMemo, useState } from 'react';
import HighlightCard from './HighlightCard.jsx';
import NotesExportSheet from './NotesExportSheet.jsx';
import NotesPrintSheet from './NotesPrintSheet.jsx';
import ProjectsSheet from './ProjectsSheet.jsx';
import CornellSheet from './CornellSheet.jsx';
import OutlineSheet from './OutlineSheet.jsx';
import { HIGHLIGHT_COLORS } from '../lib/highlightColors.js';
import {
  copyToClipboard,
  cornellToMarkdown,
  highlightsToMarkdown,
  outlineToMarkdown,
} from '../lib/exportNotes.js';

const BOOK_SORTS = [
  { id: 'title', label: 'Book title (A–Z)' },
  { id: 'recent', label: 'Recently read' },
  { id: 'count', label: 'Most highlights' },
];

const PROJECT_SORTS = [
  { id: 'title', label: 'Project order' },
  { id: 'name', label: 'Project name (A–Z)' },
  { id: 'count', label: 'Most highlights' },
];

// The bucket unfiled highlights fall into. It is last in every ordering: it is
// the pile still to be sorted, not a project.
const UNFILED = '__unfiled__';

export default function Notes({
  books,
  highlights,
  projects,
  summaries,
  onOpenHighlight,
  onEditHighlight,
  onDeleteHighlight,
  onAssignProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onReorderProjects,
  onSaveSummary,
  onRestoreBackup,
  notify,
}) {
  const [query, setQuery] = useState('');
  const [colorFilter, setColorFilter] = useState('all');
  const [bookFilter, setBookFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [groupBy, setGroupBy] = useState('book');
  const [groupSort, setGroupSort] = useState('title');
  const [notesOnly, setNotesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showExport, setShowExport] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  // 'list' is the notepad; 'cornell' is one book laid out as a study sheet.
  const [view, setView] = useState('list');

  const booksById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const summariesById = useMemo(() => new Map(summaries.map((r) => [r.id, r])), [summaries]);

  /**
   * The filtered highlights, bucketed by whichever heading is in force.
   *
   * A group is `{ id, title, subtitle, kind, entries }` rather than a book and
   * its highlights, because grouping by project mixes books inside one section
   * and every consumer downstream — the list, the export, the printed sheet —
   * needs to know which book a given quotation came from.
   */
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const buckets = new Map();

    for (const h of highlights) {
      const book = booksById.get(h.bookId);
      if (!book) continue; // book was deleted mid-render
      // A highlight can name a project this device has not synced yet; treat
      // that as unfiled rather than inventing a heading for it.
      const project = h.projectId ? projectsById.get(h.projectId) || null : null;

      if (bookFilter !== 'all' && h.bookId !== bookFilter) continue;
      if (colorFilter !== 'all' && h.color !== colorFilter) continue;
      if (notesOnly && !h.note) continue;
      if (projectFilter === UNFILED && project) continue;
      if (projectFilter !== 'all' && projectFilter !== UNFILED && project?.id !== projectFilter) {
        continue;
      }
      if (
        needle &&
        !`${h.text} ${h.note || ''} ${book.title} ${book.author || ''} ${project?.name || ''}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }

      const key = groupBy === 'project' ? project?.id || UNFILED : book.id;
      if (!buckets.has(key)) {
        buckets.set(key, {
          id: key,
          kind: groupBy,
          title: groupBy === 'project' ? project?.name || 'Unfiled' : book.title,
          subtitle: groupBy === 'project' ? '' : book.author || '',
          project,
          book: groupBy === 'book' ? book : null,
          entries: [],
        });
      }
      buckets.get(key).entries.push({ highlight: h, book });
    }

    const list = [...buckets.values()];
    for (const group of list) {
      group.entries.sort((a, b) => {
        // Inside a project the books are the outer ordering; inside a book the
        // reading order is all there is.
        if (group.kind === 'project' && a.book.id !== b.book.id) {
          return a.book.title.localeCompare(b.book.title, undefined, { sensitivity: 'base' });
        }
        return (
          (a.highlight.order ?? 0) - (b.highlight.order ?? 0) ||
          a.highlight.createdAt - b.highlight.createdAt
        );
      });
    }

    const projectRank = new Map(projects.map((p, index) => [p.id, index]));
    list.sort((a, b) => {
      if (groupBy === 'project') {
        // Unfiled is a to-do list, not a project: it sits at the bottom whatever
        // the ordering above it.
        if ((a.id === UNFILED) !== (b.id === UNFILED)) return a.id === UNFILED ? 1 : -1;
        if (groupSort === 'count') return b.entries.length - a.entries.length;
        if (groupSort === 'name') {
          return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        }
        return (projectRank.get(a.id) ?? Infinity) - (projectRank.get(b.id) ?? Infinity);
      }
      switch (groupSort) {
        case 'recent':
          return (
            (b.book.lastOpenedAt || b.book.addedAt) - (a.book.lastOpenedAt || a.book.addedAt)
          );
        case 'count':
          return b.entries.length - a.entries.length;
        default:
          return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      }
    });
    return list;
  }, [
    highlights,
    booksById,
    projectsById,
    projects,
    query,
    colorFilter,
    bookFilter,
    projectFilter,
    notesOnly,
    groupBy,
    groupSort,
  ]);

  const shown = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const shownIds = useMemo(
    () => groups.flatMap((group) => group.entries.map((entry) => entry.highlight.id)),
    [groups],
  );
  const booksWithHighlights = useMemo(() => {
    const ids = new Set(highlights.map((h) => h.bookId));
    return books
      .filter((b) => ids.has(b.id))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }, [books, highlights]);

  const changeGroupBy = (next) => {
    setGroupBy(next);
    // The two groupings do not share every ordering; fall back to the first.
    const allowed = (next === 'project' ? PROJECT_SORTS : BOOK_SORTS).map((o) => o.id);
    if (!allowed.includes(groupSort)) setGroupSort('title');
    setCollapsed(new Set());
  };

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Files every highlight currently on screen — sorting a backlog in one go. */
  const fileShown = async (projectId) => {
    if (!shownIds.length) return;
    const changed = await onAssignProject(shownIds, projectId);
    const name = projectId ? projectsById.get(projectId)?.name : null;
    notify(
      changed
        ? `${changed} highlight${changed === 1 ? '' : 's'} ${name ? `filed under ${name}` : 'unfiled'}`
        : 'Nothing to change',
      changed ? 'success' : 'info',
    );
  };

  const copyAll = async () => {
    // Copy what is on screen: the study sheet copies as a study sheet.
    if (view !== 'list') {
      if (!studyDoc) return;
      const shape = view === 'outline' ? outlineToMarkdown : cornellToMarkdown;
      const ok = await copyToClipboard(shape(studyDoc));
      notify(ok ? `Copied ${studyDoc.book.title}` : 'Could not copy', ok ? 'success' : 'error');
      return;
    }
    if (!shown) return;
    const ok = await copyToClipboard(highlightsToMarkdown(groups));
    notify(ok ? `Copied ${shown} highlight${shown === 1 ? '' : 's'}` : 'Could not copy', ok ? 'success' : 'error');
  };

  /**
   * The book being studied, when either study view is up.
   *
   * Both are documents about one book, so the view needs one chosen. Rather
   * than a second picker beside the book filter, it reuses that filter and
   * falls back to the book most recently read — the one you are most likely to
   * be writing up.
   */
  const studyBook = useMemo(() => {
    if (view === 'list') return null;
    if (bookFilter !== 'all') return booksById.get(bookFilter) || null;
    return (
      [...booksWithHighlights].sort(
        (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt),
      )[0] || null
    );
  }, [view, bookFilter, booksById, booksWithHighlights]);

  /**
   * That book's highlights as one document: sections in reading order, each
   * carrying its entries and whatever summary has been written for it.
   *
   * The Cornell sheet and the outline are two renderings of this same shape —
   * a section list with a title and its passages — so the chapter headings and
   * the reading order are decided once, here, rather than twice.
   *
   * Sections come from the chapter a highlight sits in. A PDF has no chapters,
   * so it becomes a single flow rather than one section per page — a study
   * sheet split two hundred ways is not a study sheet.
   */
  const studyDoc = useMemo(() => {
    if (!studyBook) return null;
    const record = summariesById.get(studyBook.id);
    const mine = highlights
      .filter((h) => h.bookId === studyBook.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);

    const sections = [];
    const byKey = new Map();
    for (const highlight of mine) {
      const key = studyBook.format === 'pdf' ? '' : highlight.chapter || '';
      if (!byKey.has(key)) {
        const section = { key, title: key, entries: [], summary: record?.chapters?.[key] || '' };
        byKey.set(key, section);
        sections.push(section);
      }
      byKey.get(key).entries.push({ highlight, book: studyBook });
    }

    return { book: studyBook, sections, total: mine.length, summary: record?.summary || '' };
  }, [studyBook, highlights, summariesById]);

  const isFiltered =
    !!query.trim() ||
    colorFilter !== 'all' ||
    bookFilter !== 'all' ||
    projectFilter !== 'all' ||
    notesOnly;

  const sortOptions = groupBy === 'project' ? PROJECT_SORTS : BOOK_SORTS;

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="screen-head-row">
          <h1>Notes</h1>
          <div className="head-actions">
            {shown > 0 && (
              <button type="button" className="btn" onClick={copyAll}>
                Copy
              </button>
            )}
            <button type="button" className="btn" onClick={() => setShowProjects(true)}>
              Projects
            </button>
            <button type="button" className="btn" onClick={() => setShowExport(true)}>
              Export
            </button>
          </div>
        </div>

        {highlights.length > 0 && (
          <>
            <div className="view-switch" role="group" aria-label="How notes are shown">
              <button
                type="button"
                className={view === 'list' ? 'seg is-on' : 'seg'}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                Notepad
              </button>
              <button
                type="button"
                className={view === 'cornell' ? 'seg is-on' : 'seg'}
                onClick={() => setView('cornell')}
                aria-pressed={view === 'cornell'}
              >
                Cornell sheet
              </button>
              <button
                type="button"
                className={view === 'outline' ? 'seg is-on' : 'seg'}
                onClick={() => setView('outline')}
                aria-pressed={view === 'outline'}
              >
                Outline
              </button>
            </div>

            {view !== 'list' ? (
              <div className="filters">
                <select
                  className="field field-select"
                  value={studyBook?.id || ''}
                  onChange={(e) => setBookFilter(e.target.value)}
                  aria-label="Which book to study"
                >
                  {booksWithHighlights.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
                <p className="set-hint">
                  {view === 'outline'
                    ? 'Every highlight in this book as one outline, in reading order, under the chapter it came from.'
                    : 'Every highlight in this book, in reading order. Write a cue beside each passage and a summary under each section — those are yours; the quotations are already here.'}
                </p>
              </div>
            ) : (
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
                value={groupBy}
                onChange={(e) => changeGroupBy(e.target.value)}
                aria-label="Group highlights by"
              >
                <option value="book">Group by book</option>
                <option value="project">Group by project</option>
              </select>
              <select
                className="field field-select"
                value={groupSort}
                onChange={(e) => setGroupSort(e.target.value)}
                aria-label={groupBy === 'project' ? 'Sort projects' : 'Sort books'}
              >
                {sortOptions.map((option) => (
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

              <select
                className="field field-select"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                aria-label="Filter by project"
              >
                <option value="all">All projects</option>
                <option value={UNFILED}>Unfiled</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
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
          <button type="button" className="btn" onClick={() => setShowExport(true)}>
            Restore from a backup
          </button>
          <p className="empty-hint">
            Coming from another device? Restore the backup you saved there and your highlights come
            back with it.
          </p>
        </div>
      )}

      {view === 'cornell' && studyDoc && (
        <CornellSheet
          doc={studyDoc}
          onOpenHighlight={(highlight) => onOpenHighlight(studyDoc.book, highlight)}
          onChangeCue={(id, cue) => onEditHighlight(id, { cue })}
          onChangeNote={(id, note) => onEditHighlight(id, { note })}
          onChangeSectionSummary={(key, text) =>
            onSaveSummary(studyDoc.book.id, { chapters: { [key]: text } })
          }
          onChangeSummary={(text) => onSaveSummary(studyDoc.book.id, { summary: text })}
        />
      )}

      {view === 'outline' && studyDoc && (
        <OutlineSheet
          doc={studyDoc}
          onOpenHighlight={(highlight) => onOpenHighlight(studyDoc.book, highlight)}
        />
      )}

      {view !== 'list' && !studyDoc && highlights.length > 0 && (
        <p className="muted pad">Pick a book with highlights to study.</p>
      )}

      {view === 'list' && highlights.length > 0 && shown === 0 && (
        <p className="muted pad">Nothing matches those filters.</p>
      )}

      {view === 'list' && shown > 0 && (
        <div className="notepad">
          <div className="notepad-summary">
            <p className="muted small">
              {shown} highlight{shown === 1 ? '' : 's'} across {groups.length}{' '}
              {groupBy === 'project' ? 'project' : 'book'}
              {groups.length === 1 ? '' : 's'}
            </p>
            {/*
              Filing one card at a time is fine for a new highlight and unbearable
              for a backlog, so whatever the filters have narrowed to can be filed
              in one move.
            */}
            <label className="notepad-file">
              <span className="muted small">File these {shown} into</span>
              <select
                className="field field-select field-small"
                value=""
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  e.target.value = '';
                  if (value === '__new__') onCreateProject().then((made) => made && fileShown(made.id));
                  else fileShown(value === UNFILED ? null : value);
                }}
                aria-label={`File these ${shown} highlights into a project`}
              >
                <option value="">Choose…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                <option value={UNFILED}>Nothing (unfile)</option>
                <option value="__new__">New project…</option>
              </select>
            </label>
          </div>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            return (
              <section
                key={group.id}
                className={group.id === UNFILED ? 'note-group is-unfiled' : 'note-group'}
              >
                <div className="note-group-head">
                  <button
                    type="button"
                    className="note-group-toggle"
                    onClick={() => toggle(group.id)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className={isCollapsed ? 'caret' : 'caret caret-open'} aria-hidden="true" />
                    <span className="note-group-title">
                      <strong>{group.title}</strong>
                      {group.subtitle && <em>{group.subtitle}</em>}
                    </span>
                    <span className="note-group-count">{group.entries.length}</span>
                  </button>
                </div>

                {!isCollapsed && (
                  <ul className="note-list">
                    {group.entries.map(({ highlight, book }) => (
                      <HighlightCard
                        key={highlight.id}
                        highlight={highlight}
                        // Under a project heading the book is what places the
                        // quotation; under a book heading it would just repeat.
                        book={group.kind === 'project' ? book : null}
                        projects={projects}
                        project={projectsById.get(highlight.projectId) || null}
                        onOpen={() => onOpenHighlight(book, highlight)}
                        onChangeColor={(color) => onEditHighlight(highlight.id, { color })}
                        onChangeNote={(note) => onEditHighlight(highlight.id, { note })}
                        onChangeProject={async (projectId) => {
                          if (projectId !== '__new__') {
                            await onAssignProject([highlight.id], projectId);
                            return;
                          }
                          const made = await onCreateProject();
                          if (made) await onAssignProject([highlight.id], made.id);
                        }}
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

      {/* The print rendition follows whatever is on screen, so the browser's own
          Print command produces the document you were just looking at. */}
      {view === 'cornell' && studyDoc && <NotesPrintSheet cornell={studyDoc} />}
      {view === 'outline' && studyDoc && <NotesPrintSheet outline={studyDoc} />}

      {view === 'list' && shown > 0 && (
        <NotesPrintSheet
          groups={groups}
          total={shown}
          unit={groupBy === 'project' ? 'project' : 'book'}
        />
      )}

      {showProjects && (
        <ProjectsSheet
          projects={projects}
          highlights={highlights}
          onCreate={onCreateProject}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
          onReorder={onReorderProjects}
          onClose={() => setShowProjects(false)}
        />
      )}

      {showExport && (
        <NotesExportSheet
          groups={groups}
          shown={shown}
          total={highlights.length}
          filtered={isFiltered}
          onRestoreBackup={onRestoreBackup}
          notify={notify}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
