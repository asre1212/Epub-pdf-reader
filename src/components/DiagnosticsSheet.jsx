import { useEffect, useState } from 'react';
import {
  clearTraces,
  describeTrace,
  environmentSummary,
  formatTraces,
  getTraces,
  subscribeTraces,
} from '../lib/highlighterTrace.js';
import { copyToClipboard, downloadText } from '../lib/exportNotes.js';

/**
 * What the last few highlighter gestures did, on this device.
 *
 * The highlighter runs inside an epub.js iframe on hardware the author of a bug
 * report is holding and the author of the fix is not. This is the bridge: drag,
 * open this, and every branch the gesture took is written down in one screen.
 */
export default function DiagnosticsSheet({ format, onSelfTest, onClose, notify }) {
  const [traces, setTraces] = useState(getTraces());
  const [steps, setSteps] = useState(null);

  useEffect(() => subscribeTraces((next) => setTraces([...next])), []);

  const report = () =>
    [
      environmentSummary(),
      '',
      steps
        ? ['self-test:', ...steps.map((s) => `  [${s.ok ? 'ok' : 'FAIL'}] ${s.name}${s.detail ? ` — ${s.detail}` : ''}`)].join('\n')
        : 'self-test: not run',
      '',
      formatTraces(),
    ].join('\n');

  const copy = async () => {
    const ok = await copyToClipboard(report());
    notify?.(ok ? 'Diagnostics copied' : 'Could not copy', ok ? 'success' : 'error');
  };

  const save = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadText(`highlighter-diagnostics-${stamp}.txt`, report());
  };

  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const result = await onSelfTest?.();
      setSteps(result || [{ name: 'self-test available', ok: false, detail: 'not supported here' }]);
    } catch (err) {
      setSteps([{ name: 'self-test ran', ok: false, detail: String(err?.message || err) }]);
    } finally {
      setRunning(false);
    }
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
          Two halves. The <strong>self-test</strong> runs the whole highlight pipeline on the page
          behind this sheet without anyone touching the screen, so it works even when a drag never
          registers. The <strong>gestures</strong> below are what happened when a finger did arrive
          — if that list stays empty after you drag, the touch is not reaching the highlighter at
          all, which is a different fault entirely.
        </p>

        {format === 'epub' && (
          <>
            <button type="button" className="btn" onClick={run} disabled={running}>
              {running ? 'Running…' : steps ? 'Run the self-test again' : 'Run the self-test'}
            </button>
            {steps && (
              <ol className="diag-steps">
                {steps.map((step, index) => (
                  <li key={index} className={step.ok ? 'diag-step is-ok' : 'diag-step is-bad'}>
                    <span className="diag-step-mark" aria-hidden="true">
                      {step.ok ? '✓' : '✕'}
                    </span>
                    <span>
                      {step.name}
                      {step.detail && <em className="diag-step-detail">{step.detail}</em>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

        <h3 className="diag-subhead">Gestures</h3>

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
          <button type="button" className="btn" onClick={save}>
            Save file
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
