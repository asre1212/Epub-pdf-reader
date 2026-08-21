import { useEffect, useRef, useState } from 'react';

/**
 * A textarea that grows to its content, committing on blur.
 *
 * Study documents are read as documents, so an inner scrollbar in the middle of
 * one is wrong: the field takes the height of what is in it and the page scrolls
 * as a whole. Committing on blur rather than on every keystroke keeps the write
 * to one per edit, which is also the right unit for sync to resolve.
 */
export default function GrowingField({
  value,
  onCommit,
  placeholder,
  className,
  rows = 2,
  ariaLabel,
}) {
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
