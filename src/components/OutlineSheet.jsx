import { colorHex } from '../lib/highlightColors.js';

/**
 * A book's highlights as one continuous outline.
 *
 * Where the Cornell sheet is a worksheet with room to write, this is the
 * finished shape: headings taken from the chapter each passage was highlighted
 * in, the passages beneath them as bullets, and a reader's note nested under
 * the passage it belongs to. Nothing is editable here on purpose — the notepad
 * and the Cornell sheet are where notes are written; this is where they are
 * read back in order.
 *
 * The indentation carries the structure, so it holds at any width: a level is
 * one step in, not a column that has to be given up on a phone.
 */

function place(highlight) {
  if (highlight.format === 'pdf') return highlight.page ? `p. ${highlight.page}` : '';
  return '';
}

export default function OutlineSheet({ doc, onOpenHighlight }) {
  const { book, sections, total } = doc;
  // A book whose highlights carry no chapter is one unbroken list; numbering a
  // single unnamed section would be a heading with nothing to distinguish.
  const numbered = sections.length > 1 || !!sections[0]?.title;

  return (
    <article className="outline">
      <header className="outline-head">
        <h2>{book.title}</h2>
        <p>
          {[book.author, `${total} highlight${total === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </p>
      </header>

      <ol className="outline-sections">
        {sections.map((section, index) => (
          <li key={section.key} className="outline-section">
            {section.title && (
              <h3 className="outline-section-title">
                {numbered && <span className="outline-marker">{index + 1}.</span>}
                {section.title}
              </h3>
            )}

            <ul className="outline-points">
              {section.entries.map(({ highlight }) => {
                const where = place(highlight);
                return (
                  <li
                    key={highlight.id}
                    className="outline-point"
                    style={{ '--note-color': colorHex(highlight.color) }}
                  >
                    <button
                      type="button"
                      className="outline-text"
                      onClick={() => onOpenHighlight(highlight)}
                      title="Open in the book"
                    >
                      {highlight.text}
                      {where && <span className="outline-where"> ({where})</span>}
                    </button>

                    {highlight.cue && <p className="outline-cue">{highlight.cue}</p>}

                    {highlight.note && (
                      <ul className="outline-subpoints">
                        <li>{highlight.note}</li>
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            {section.summary && (
              <p className="outline-summary">
                <strong>Summary.</strong> {section.summary}
              </p>
            )}
          </li>
        ))}
      </ol>

      {doc.summary && (
        <p className="outline-summary outline-summary-book">
          <strong>Summary — {book.title}.</strong> {doc.summary}
        </p>
      )}
    </article>
  );
}
