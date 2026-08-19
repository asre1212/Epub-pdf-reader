import { useEffect, useState } from 'react';
import {
  clearTraces,
  describeTrace,
  environmentSummary,
  formatTraces,
  getTraces,
  subscribeTraces,
} from '../lib/highlighterTrace.js';
import { copyToClipboard } from '../lib/exportNotes.js';

/**
 * What the last few highlighter gestures did, on this device.
 *
 * The highlighter runs inside an epub.js iframe on hardware the author of a bug
 * report is holding and the author of the fix is not. This is the bridge: drag,
 * open this, and every branch the gesture took is written down in one screen.
 */
export default function DiagnosticsSheet({ onClose, notify }) {
  const [traces, setTraces] = useState(getTraces());

  useEffect(() => subscribeTraces((next) => setTraces([...next])), []);

  const copy = async () => {
    const ok = await copyToClipboard(`${environmentSummary()}\n\n${formatTraces()}`);
    notify?.(ok ? 'Diagnostics copied' : 'Could not copy', ok ? 'success' : 'error');
  };

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Highlighter diagnostics"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">Highlighter diagnostics</h2>
        <p className="set-hint">
          The last few drags, newest first. Turn the highlighter on, drag across a line, then come
          back here — <em>outcome</em> says what happened and the lines under it say why.
        </p>

        {!traces.length && (
          <p className="diag-empty">
            Nothing recorded yet. Close this, drag across some text with the highlighter on, and
            open it again.
          </p>
        )}

        <ol className="diag-list">
          {traces.map((trace) => (
            <li key={trace.at} className={`diag-entry is-${trace.outcome}`}>
              <div className="diag-head">
                <strong>{trace.outcome}</strong>
                <span>
                  {new Date(trace.at).toLocaleTimeString()} · {trace.view} · {trace.flow}
                </span>
              </div>
              {describeTrace(trace).map((line, index) => (
                <div key={index} className="diag-line">
                  {line}
                </div>
              ))}
            </li>
          ))}
        </ol>

        <pre className="diag-env">{environmentSummary()}</pre>

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={() => clearTraces()}>
            Clear
          </button>
          <button type="button" className="btn" onClick={copy}>
            Copy all
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
