import { useEffect, useRef, useState } from 'react';

/** Modal for writing or editing the note attached to a highlight. */
export default function NoteDialog({ quote, note, onSave, onClose }) {
  const [draft, setDraft] = useState(note || '');
  const textarea = useRef(null);

  useEffect(() => {
    textarea.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Captured so the reader's Escape handler does not close the book too.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet sheet-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Highlight note"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">Note</h2>
        {quote && <blockquote className="note-quote">{quote}</blockquote>}
        <textarea
          ref={textarea}
          className="note-input"
          rows={5}
          value={draft}
          placeholder="What do you want to remember about this?"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(draft.trim());
          }}
        />
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(draft.trim())}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
