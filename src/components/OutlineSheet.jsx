import { useState } from 'react';
import { colorHex } from '../lib/highlightColors.js';
import GrowingField from './GrowingField.jsx';
import { sentenceCase } from '../lib/textCase.js';

/**
 * A book's highlights as one continuous outline.
 *
 * Where the Cornell sheet is a worksheet with room to write, this is the
 * finished shape: headings taken from the chapter each passage was highlighted
 * in, the passages beneath them as bullets, and a reader's note nested under
 * the passage it belongs to.
 *
 * Reading and editing are separate modes rather than one permissive screen. An
 * outline is mostly read, and a page of textareas reads worse than a page of
 * text — so the fields appear only when the pen is on, and until then a tap on
 * a passage opens it in the book instead of putting a caret in it.
 */

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4 16z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function place(highlight) {
  if (highlight.format === 'pdf') return highlight.page ? `p. ${highlight.page}` : '';
  return '';
}

export default function OutlineSheet({ doc, onOpenHighlight, onChangeText, onChangeNote, onChangeCue }) {
  const [editing, setEditing] = useState(false);
  const { book, sections, total } = doc;
  // A book whose highlights carry no chapter is one unbroken list; numbering a
  // single unnamed section would be a heading with nothing to distinguish.
  const numbered = sections.length > 1 || !!sections[0]?.title;

  return (
    <article className={editing ? 'outline is-editing' : 'outline'}>
      <header className="outline-head">
        <div className="outline-head-row">
          <h2>{book.title}</h2>
          <button
            type="button"
            className={editing ? 'icon-btn icon-btn-on' : 'icon-btn'}
            onClick={() => setEditing((on) => !on)}
            aria-pressed={editing}
            aria-label={editing ? 'Finish editing the outline' : 'Edit the outline'}
            title={editing ? 'Done editing' : 'Edit'}
          >
            <PenIcon />
          </button>
        </div>
        <p>
          {[book.author, `${total} highlight${total === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          {editing && ' · editing'}
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
                    {editing ? (
                      <GrowingField
                        className="outline-text-input"
                        rows={1}
                        value={highlight.text}
                        ariaLabel="Passage"
                        onCommit={(text) => text && onChangeText(highlight.id, text)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="outline-text"
                        onClick={() => onOpenHighlight(highlight)}
                        title="Open in the book"
                      >
                        {sentenceCase(highlight.text)}
                        {where && <span className="outline-where"> ({where})</span>}
                      </button>
                    )}

                    {editing ? (
                      <GrowingField
                        className="outline-cue-input"
                        rows={1}
                        value={highlight.cue}
                        placeholder="Keyword or question…"
                        ariaLabel="Cue"
                        onCommit={(cue) => onChangeCue(highlight.id, cue)}
                      />
                    ) : (
                      highlight.cue && <p className="outline-cue">{sentenceCase(highlight.cue)}</p>
                    )}

                    {editing ? (
                      <div className="outline-subpoints is-editing">
                        <GrowingField
                          className="outline-note-input"
                          rows={1}
                          value={highlight.note}
                          placeholder="Your note…"
                          ariaLabel="Note"
                          onCommit={(note) => onChangeNote(highlight.id, note)}
                        />
                      </div>
                    ) : (
                      highlight.note && (
                        <ul className="outline-subpoints">
                          <li>{sentenceCase(highlight.note)}</li>
                        </ul>
                      )
                    )}
                  </li>
                );
              })}
            </ul>

            {section.summary && (
              <p className="outline-summary">
                <strong>Summary.</strong> {sentenceCase(section.summary)}
              </p>
            )}
          </li>
        ))}
      </ol>

      {doc.summary && (
        <p className="outline-summary outline-summary-book">
          <strong>Summary — {book.title}.</strong> {sentenceCase(doc.summary)}
        </p>
      )}
    </article>
  );
}
