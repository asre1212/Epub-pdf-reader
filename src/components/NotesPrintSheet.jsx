import { createPortal } from 'react-dom';
import { colorHex, colorLabel } from '../lib/highlightColors.js';

function where(highlight) {
  if (highlight.format === 'pdf') return `Page ${highlight.page}`;
  return highlight.chapter || '';
}

/**
 * The print rendition of the notepad, kept out of the on-screen layout and
 * revealed only by the print stylesheet. It lives beside the app rather than
 * inside it so print rules do not have to undo the app's fixed, scrolling shell.
 *
 * Rendering it whenever notes are on screen means the browser's own Print
 * command produces the same document as the Export button.
 */
export default function NotesPrintSheet({ groups, total }) {
  const exported = new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return createPortal(
    <article className="printsheet">
      <header className="printsheet-head">
        <h1>Highlights</h1>
        <p>
          {total} highlight{total === 1 ? '' : 's'} across {groups.length} book
          {groups.length === 1 ? '' : 's'} · {exported}
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.book.id} className="printsheet-book">
          <h2>{group.book.title}</h2>
          {group.book.author && <p className="printsheet-author">{group.book.author}</p>}

          {group.highlights.map((highlight) => (
            <div
              key={highlight.id}
              className="printnote"
              style={{ '--note-color': colorHex(highlight.color) }}
            >
              <p className="printnote-text">{highlight.text}</p>
              {highlight.note && <p className="printnote-note">{highlight.note}</p>}
              <p className="printnote-meta">
                {[colorLabel(highlight.color), where(highlight)].filter(Boolean).join(' · ')}
              </p>
            </div>
          ))}
        </section>
      ))}
    </article>,
    document.body,
  );
}
