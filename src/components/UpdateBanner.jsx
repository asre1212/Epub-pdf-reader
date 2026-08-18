/** Sits above the tab bar when a new version is installed and waiting. */
export default function UpdateBanner({ applying, onUpdate, onDismiss }) {
  return (
    <div className="updatebar" role="status">
      <span className="updatebar-dot" aria-hidden="true" />
      <div className="updatebar-text">
        <strong>A new version is ready</strong>
        <span>Your books and highlights are kept.</span>
      </div>
      <button type="button" className="btn btn-primary btn-small" onClick={onUpdate} disabled={applying}>
        {applying ? 'Updating…' : 'Update now'}
      </button>
      <button type="button" className="updatebar-close" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
