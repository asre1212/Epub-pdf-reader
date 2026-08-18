import { APP_VERSION, BUILD_TIME } from '../lib/appUpdates.js';

function formatWhen(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function relativeTime(timestamp) {
  if (!timestamp) return 'not yet';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Version, update controls, and the offline/storage status of the install. */
export default function AboutSheet({ update, usage, onCheck, onUpdate, onToggleAuto, onClose }) {
  const built = formatWhen(BUILD_TIME);

  let status;
  if (!update.supported) {
    status = 'This browser cannot install updates in the background.';
  } else if (!update.registered) {
    status = 'Updates run from the installed app or a production build.';
  } else if (update.applying) {
    status = 'Installing the new version…';
  } else if (update.needRefresh) {
    status = 'A new version is downloaded and ready to install.';
  } else if (update.checking) {
    status = 'Checking for updates…';
  } else if (update.error) {
    status = update.error;
  } else {
    status = `You are up to date. Last checked ${relativeTime(update.lastCheckedAt)}.`;
  }

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="About this app"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">About</h2>

        <div className="about-id">
          <div className="about-mark" aria-hidden="true" />
          <div>
            <strong>Marginalia</strong>
            <span className="muted small">
              Version {APP_VERSION}
              {built ? ` · built ${built}` : ''}
            </span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-label">
            <span>Updates</span>
            {update.needRefresh && !update.applying && <span className="pill">Ready</span>}
          </div>

          <p className={update.error && !update.needRefresh ? 'set-hint is-error' : 'set-hint'}>
            {status}
          </p>

          <div className="about-actions">
            <button
              type="button"
              className="btn"
              onClick={onCheck}
              disabled={!update.registered || update.checking || update.applying}
            >
              {update.checking ? 'Checking…' : 'Check for updates'}
            </button>
            {update.needRefresh && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onUpdate}
                disabled={update.applying}
              >
                {update.applying ? 'Updating…' : 'Update now'}
              </button>
            )}
          </div>
        </div>

        <label className="toggle toggle-row">
          <input
            type="checkbox"
            checked={update.autoUpdate}
            onChange={(e) => onToggleAuto(e.target.checked)}
          />
          <span>
            Install updates automatically
            <em className="toggle-hint">
              Applied in the background, and never while a book is open.
            </em>
          </span>
        </label>

        <div className="set-row">
          <div className="set-label">
            <span>Offline</span>
            <span className="set-value">{update.offlineReady ? 'Ready' : 'Preparing'}</span>
          </div>
          <p className="set-hint">
            {update.offlineReady
              ? 'The reader and both book engines are stored on this device, so your library opens without a connection.'
              : 'Finishing the first download. Once it completes the app works offline.'}
            {usage?.usage
              ? ` Currently using ${(usage.usage / 1024 / 1024).toFixed(1)} MB of local storage.`
              : ''}
          </p>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
