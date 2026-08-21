import { useEffect, useRef, useState } from 'react';
import { colorHex } from '../lib/highlightColors.js';

/**
 * A book's highlights as one Cornell document.
 *
 * The method's three parts are load-bearing, not decoration: a narrow cue
 * column for the keyword or question that recalls the passage, a wide notes
 * column for the passage and what you made of it, and a summary band closing
 * each section and the document. The cues and summaries are the reader's to
 * write — the app supplies only what it already knows, which is the quotations.
 *
 * On a phone the two columns stack, because a 30/70 split of a 390px screen is
 * two unreadable columns rather than a study sheet. The cue keeps its place by
 * sitting above its passage and reading as a label.
 */

/** A textarea that grows to its content, so the document has no inner scrollbars. */
function Growing({ value, onCommit, placeholder, className, rows = 2, ariaLabel }) {
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => setDraft(value || ''), [value]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [draft]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={rows}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if ((draft || '') !== (value || '')) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value || '');
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function where(highlight) {
  if (highlight.format === 'pdf') return highlight.page ? `p. ${highlight.page}` : '';
  return highlight.chapter || '';
}

export default function CornellSheet({
  doc,
  onOpenHighlight,
  onChangeCue,
  onChangeNote,
  onChangeSectionSummary,
  onChangeSummary,
}) {
  const { book, sections, summary, total } = doc;

  return (
    <article className="cornell">
      <header className="cornell-head">
        <h2>{book.title}</h2>
        <p>
          {[book.author, `${total} highlight${total === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </p>
      </header>

      {sections.map((section) => (
        <section key={section.key} className="cornell-section">
          {section.title && <h3 className="cornell-section-title">{section.title}</h3>}

          <div className="cornell-grid">
            <div className="cornell-legend" aria-hidden="true">
              <span>Cues</span>
              <span>Notes</span>
            </div>

            {section.entries.map(({ highlight }) => {
              // The section is already titled with the chapter; repeating it
              // under every cue is noise. A PDF's page number is not.
              const place = where(highlight);
              return (
              <div
                key={highlight.id}
                className="cornell-row"
                style={{ '--note-color': colorHex(highlight.color) }}
              >
                <div className="cornell-cue">
                  <Growing
                    className="cornell-cue-input"
                    value={highlight.cue}
                    placeholder="Keyword or question…"
                    ariaLabel="Cue for this passage"
                    onCommit={(cue) => onChangeCue(highlight.id, cue)}
                  />
                  {place && place !== section.title && (
                    <span className="cornell-where">{place}</span>
                  )}
                </div>

                <div className="cornell-note">
                  <button
                    type="button"
                    className="cornell-quote"
                    onClick={() => onOpenHighlight(highlight)}
                    title="Open in the book"
                  >
                    {highlight.text}
                  </button>
                  <Growing
                    className="cornell-note-input"
                    value={highlight.note}
                    placeholder="What you made of it…"
                    ariaLabel="Note on this passage"
                    onCommit={(note) => onChangeNote(highlight.id, note)}
                  />
                </div>
              </div>
              );
            })}
          </div>

          <div className="cornell-summary cornell-summary-section">
            <h4>{section.title ? `Summary — ${section.title}` : 'Section summary'}</h4>
            <Growing
              className="cornell-summary-input"
              rows={2}
              value={section.summary}
              placeholder="In your own words, what does this section say?"
              ariaLabel={`Summary of ${section.title || 'this section'}`}
              onCommit={(text) => onChangeSectionSummary(section.key, text)}
            />
          </div>
        </section>
      ))}

      <div className="cornell-summary cornell-summary-book">
        <h4>Summary — {book.title}</h4>
        <Growing
          className="cornell-summary-input"
          rows={4}
          value={summary}
          placeholder="The whole book in a few sentences. Write this last."
          ariaLabel="Summary of the book"
          onCommit={onChangeSummary}
        />
      </div>
    </article>
  );
}
