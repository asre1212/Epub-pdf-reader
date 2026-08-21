import { createPortal } from 'react-dom';
import { colorHex, colorLabel } from '../lib/highlightColors.js';
import { sentenceCase } from '../lib/textCase.js';

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
/** The Cornell sheet as a printed document: two columns and the summary bands. */
function CornellPrint({ doc, exported }) {
  return (
    <article className="printsheet printsheet-cornell">
      <header className="printsheet-head">
        <h1>{doc.book.title}</h1>
        <p>
          {[doc.book.author, `${doc.total} highlight${doc.total === 1 ? '' : 's'}`, exported]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {doc.sections.map((section) => (
        <section key={section.key} className="printsheet-book">
          {section.title && <h2>{section.title}</h2>}
          {section.entries.map(({ highlight }) => (
            <div
              key={highlight.id}
              className="printcornell"
              style={{ '--note-color': colorHex(highlight.color) }}
            >
              <div className="printcornell-cue">
                <p>{highlight.cue || ''}</p>
                <span>{where(highlight)}</span>
              </div>
              <div className="printcornell-note">
                <p className="printnote-text">{highlight.text}</p>
                {highlight.note && <p className="printnote-note">{highlight.note}</p>}
              </div>
            </div>
          ))}
          {section.summary && (
            <div className="printcornell-summary">
              <h3>Summary{section.title ? ` — ${section.title}` : ''}</h3>
              <p>{section.summary}</p>
            </div>
          )}
        </section>
      ))}

      {doc.summary && (
        <div className="printcornell-summary printcornell-summary-book">
          <h3>Summary — {doc.book.title}</h3>
          <p>{doc.summary}</p>
        </div>
      )}
    </article>
  );
}

/** The outline as a printed document: headings, bullets, nested notes. */
function OutlinePrint({ doc, exported }) {
  const numbered = doc.sections.length > 1 || !!doc.sections[0]?.title;
  return (
    <article className="printsheet printsheet-outline">
      <header className="printsheet-head">
        <h1>{doc.book.title}</h1>
        <p>
          {[doc.book.author, `${doc.total} highlight${doc.total === 1 ? '' : 's'}`, exported]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {doc.sections.map((section, index) => (
        <section key={section.key} className="printsheet-book">
          {section.title && (
            <h2>
              {numbered ? `${index + 1}. ` : ''}
              {section.title}
            </h2>
          )}
          <ul className="printoutline">
            {section.entries.map(({ highlight }) => (
              <li key={highlight.id} style={{ '--note-color': colorHex(highlight.color) }}>
                {sentenceCase(highlight.text)}
                {highlight.format === 'pdf' && highlight.page && (
                  <span className="printoutline-where"> (p. {highlight.page})</span>
                )}
                {(highlight.cue || highlight.note) && (
                  <ul>
                    {highlight.cue && (
                      <li>
                        <strong>{sentenceCase(highlight.cue)}</strong>
                      </li>
                    )}
                    {highlight.note && <li>{sentenceCase(highlight.note)}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {section.summary && (
            <p className="printoutline-summary">
              <strong>Summary.</strong> {section.summary}
            </p>
          )}
        </section>
      ))}

      {doc.summary && (
        <p className="printoutline-summary">
          <strong>Summary — {doc.book.title}.</strong> {doc.summary}
        </p>
      )}
    </article>
  );
}

export default function NotesPrintSheet({
  groups,
  total,
  unit = 'book',
  cornell = null,
  outline = null,
}) {
  const exported = new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (cornell) return createPortal(<CornellPrint doc={cornell} exported={exported} />, document.body);
  if (outline) return createPortal(<OutlinePrint doc={outline} exported={exported} />, document.body);

  return createPortal(
    <article className="printsheet">
      <header className="printsheet-head">
        <h1>Highlights</h1>
        <p>
          {total} highlight{total === 1 ? '' : 's'} across {groups.length} {unit}
          {groups.length === 1 ? '' : 's'} · {exported}
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.id} className="printsheet-book">
          <h2>{group.title}</h2>
          {group.subtitle && <p className="printsheet-author">{group.subtitle}</p>}

          {group.entries.map(({ highlight, book }) => (
            <div
              key={highlight.id}
              className="printnote"
              style={{ '--note-color': colorHex(highlight.color) }}
            >
              <p className="printnote-text">{highlight.text}</p>
              {highlight.note && <p className="printnote-note">{highlight.note}</p>}
              <p className="printnote-meta">
                {[
                  colorLabel(highlight.color),
                  where(highlight),
                  // Under a project heading the book is the missing half of the
                  // citation; under a book heading it is already overhead.
                  group.kind !== 'book' ? book?.title : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          ))}
        </section>
      ))}
    </article>,
    document.body,
  );
}
