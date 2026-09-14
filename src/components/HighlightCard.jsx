import { useDraft } from '../lib/useDraft.js';
import { useEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, colorHex } from '../lib/highlightColors.js';

function where(highlight) {
  if (highlight.format === 'pdf') return `Page ${highlight.page}`;
  return highlight.chapter || '';
}

export default function HighlightCard({
  highlight,
  book,
  projects = [],
  project,
  onOpen,
  onChangeColor,
  onChangeNote,
  onChangeProject,
  onDelete,
  onCopy,
}) {
  const [editing, setEditing] = useState(false);
  const { draft, setDraft, commit, discard, error, saving } = useDraft(`highlight:${highlight.id}:note`, highlight.note, onChangeNote);
  const textarea = useRef(null);
  useEffect(() => { if (draft !== (highlight.note || '')) setEditing(true); }, []);


  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  const saveNote = async () => { if (await commit()) setEditing(false); };

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
                discard();
                setEditing(false);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
            }}
          />
          {error && <p role="alert">{error}</p>}
          <div className="note-editor-actions">
            <button type="button" className="btn btn-small" disabled={saving} onClick={saveNote}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => {
                discard();
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="note-foot">
        <span className="note-where">
          {[book?.title, where(highlight)].filter(Boolean).join(' · ')}
        </span>

        {onChangeProject && (
          <label className="note-project">
            <span className="visually-hidden">Project</span>
            <select
              className="field field-select field-small"
              value={highlight.projectId || ''}
              onChange={(e) => onChangeProject(e.target.value || null)}
            >
              <option value="">Unfiled</option>
              {projects.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              {/*
                A project the reader has not synced yet still names this
                highlight; showing the raw id would be worse than showing that
                something is there.
              */}
              {highlight.projectId && !project && (
                <option value={highlight.projectId}>Project not on this device</option>
              )}
              <option value="__new__">New project…</option>
            </select>
          </label>
        )}

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
