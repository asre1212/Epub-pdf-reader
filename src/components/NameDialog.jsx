import { useEffect, useRef, useState } from 'react';

/** Modal for naming something — a new project, so far. */
export default function NameDialog({
  title,
  label,
  placeholder = '',
  initial = '',
  confirmLabel = 'Save',
  onSubmit,
  onClose,
}) {
  const [draft, setDraft] = useState(initial);
  const input = useRef(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Captured so a reader underneath does not close the book too.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    onSubmit(name);
  };

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet sheet-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">{title}</h2>
        <label className="name-field">
          <span className="muted small">{label}</span>
          <input
            ref={input}
            className="field"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!draft.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
