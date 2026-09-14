import { useEffect, useRef } from 'react';
import { useDraft } from '../lib/useDraft.js';

/** A recoverable draft, committed on blur with an explicit retry on failure. */
export default function GrowingField({ draftKey, value, onCommit, placeholder, className, rows = 2, ariaLabel }) {
  const { draft, setDraft, commit, discard, error, saving } = useDraft(draftKey, value, onCommit);
  const ref = useRef(null);
  const cancelled = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (node) { node.style.height = 'auto'; node.style.height = node.scrollHeight + 'px'; }
  }, [draft]);
  return (
    <>
      <textarea ref={ref} className={className} rows={rows} value={draft}
        placeholder={placeholder} aria-label={ariaLabel} aria-busy={saving}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (!cancelled.current) void commit(); cancelled.current = false; }}
        onKeyDown={e => {
          if (e.key === 'Escape') { cancelled.current = true; discard(); e.currentTarget.blur(); }
        }}
      />
      {error && <span role="alert">{error} <button type="button" onClick={commit}>Retry save</button></span>}
    </>
  );
}
