import { useDraft } from '../lib/useDraft.js';
import { useEffect, useRef, useState } from 'react';

/** Modal for writing or editing the note attached to a highlight. */
export default function NoteDialog({ draftKey, quote, note, onSave, onClose }) {
  const { draft, setDraft, commit, discard, error, saving } = useDraft(draftKey, note, onSave);
  const close = () => { discard(); onClose(); };
  const closeRef = useRef(close); closeRef.current = close;
  const textarea = useRef(null);

  useEffect(() => {
    textarea.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Captured so the reader's Escape handler does not close the book too.
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
          }}
        />
        {error && <p role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => commit()}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
