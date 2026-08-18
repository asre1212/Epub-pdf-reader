import { useEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, colorHex } from '../lib/highlightColors.js';

function where(highlight) {
  if (highlight.format === 'pdf') return `Page ${highlight.page}`;
  return highlight.chapter || '';
}

export default function HighlightCard({
  highlight,
  onOpen,
  onChangeColor,
  onChangeNote,
  onDelete,
  onCopy,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(highlight.note || '');
  const textarea = useRef(null);

  useEffect(() => {
    setDraft(highlight.note || '');
  }, [highlight.note]);

  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  const saveNote = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (highlight.note || '')) onChangeNote(next);
  };

  return (
    <li className="note" style={{ '--note-color': colorHex(highlight.color) }}>
      <button type="button" className="note-text" onClick={onOpen} title="Open in the book">
        {highlight.text}
      </button>

      {highlight.note && !editing && (
        <p className="note-annotation" onClick={() => setEditing(true)}>
          {highlight.note}
        </p>
      )}

      {editing && (
        <div className="note-editor">
          <textarea
            ref={textarea}
            value={draft}
            rows={3}
            placeholder="Write a note…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(highlight.note || '');
                setEditing(false);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
            }}
          />
          <div className="note-editor-actions">
            <button type="button" className="btn btn-small" onClick={saveNote}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => {
                setDraft(highlight.note || '');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="note-foot">
        <span className="note-where">{where(highlight)}</span>

        <div className="note-actions">
          <div className="swatch-row" role="group" aria-label="Highlight colour">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={highlight.color === color.id ? 'swatch is-on' : 'swatch'}
                style={{ '--swatch': color.hex }}
                onClick={() => onChangeColor(color.id)}
                title={color.label}
                aria-label={color.label}
                aria-pressed={highlight.color === color.id}
              />
            ))}
          </div>
          {!editing && (
            <button type="button" className="link" onClick={() => setEditing(true)}>
              {highlight.note ? 'Edit note' : 'Add note'}
            </button>
          )}
          <button type="button" className="link" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="link danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
