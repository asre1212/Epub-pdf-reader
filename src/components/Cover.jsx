import { useEffect, useState } from 'react';

/** Renders a stored cover Blob, falling back to a generated title card. */
export default function Cover({ book, className = '' }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!book?.cover) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(book.cover);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [book?.cover]);

  if (url) {
    return <img className={`cover ${className}`} src={url} alt="" loading="lazy" decoding="async" />;
  }

  // Deterministic hue so a given book always gets the same placeholder.
  const seed = [...(book?.title || '?')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <div
      className={`cover cover-fallback ${className}`}
      style={{ '--cover-hue': seed }}
      aria-hidden="true"
    >
      <span className="cover-fallback-title">{book?.title || 'Untitled'}</span>
      {book?.author && <span className="cover-fallback-author">{book.author}</span>}
      <span className="cover-fallback-format">{(book?.format || '').toUpperCase()}</span>
    </div>
  );
}
