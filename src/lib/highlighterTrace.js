/**
 * A record of what the highlighter actually did, on the device it did it on.
 *
 * The highlighter reaches into an epub.js iframe on a phone, and the ways that
 * can fail are not visible from the outside: the gesture looks identical
 * whether no touch arrived, no text could be measured, or a range was built and
 * refused a CFI. Two attempts at fixing this from a desktop browser missed
 * because a desktop browser cannot tell those apart either.
 *
 * So each gesture leaves a trace, and the reader can read it back. Nothing here
 * is diagnostic plumbing for its own sake — every field below is the answer to
 * one specific question about where a drag died.
 */

const LIMIT = 6;
const traces = [];
const listeners = new Set();

export function recordTrace(trace) {
  traces.unshift({ at: Date.now(), ...trace });
  if (traces.length > LIMIT) traces.length = LIMIT;
  for (const listener of listeners) listener(traces);
}

export function getTraces() {
  return traces;
}

export function subscribeTraces(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearTraces() {
  traces.length = 0;
  for (const listener of listeners) listener(traces);
}

function yesNo(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '—';
}

/** One gesture as a handful of lines, for reading on screen. */
export function describeTrace(trace) {
  const lines = [];
  const { events = {}, index = {}, doc = {}, stage = {} } = trace;

  lines.push(`outcome: ${trace.outcome}${trace.reason ? ` (${trace.reason})` : ''}`);
  lines.push(
    `touches: start ${events.start || 0}, move ${events.move || 0}, end ${events.end || 0}` +
      ` · pointer ${trace.pointer || '—'} · cancelable ${yesNo(events.cancelable)}`,
  );
  lines.push(
    `page: frame ${Math.round(doc.frameWidth)}×${Math.round(doc.frameHeight)}` +
      ` · window ${Math.round(doc.innerWidth)}×${Math.round(doc.innerHeight)}` +
      ` · text nodes ${doc.textNodes ?? '—'}`,
  );
  lines.push(
    `visible box: ${stage.box || 'none'}` +
      ` · words on page ${index.page ?? '—'}` +
      `, in window ${index.viewport ?? '—'}` +
      `, anywhere ${index.all ?? '—'}`,
  );
  lines.push(
    `caret API: present ${yesNo(trace.caretApi)}, answered ${yesNo(trace.caretApiHit)}` +
      ` · anchor ${yesNo(trace.anchor)} · focus ${yesNo(trace.focus)}`,
  );
  lines.push(
    `range: ${trace.textLength ?? 0} chars${trace.text ? ` “${trace.text}”` : ''}` +
      ` · anchored ${yesNo(trace.anchored)}${trace.error ? ` · error ${trace.error}` : ''}`,
  );
  if (trace.nativeSelection) lines.push(`native selection: ${trace.nativeSelection}`);
  return lines;
}

/** Every trace as plain text, for pasting into a bug report. */
export function formatTraces() {
  if (!traces.length) return 'No highlighter gestures recorded yet.';
  return traces
    .map((trace, position) => {
      const when = new Date(trace.at).toLocaleTimeString();
      const head = `#${position + 1} ${when} · ${trace.view || 'view'} · ${trace.flow || ''}`.trim();
      return [head, ...describeTrace(trace).map((line) => `  ${line}`)].join('\n');
    })
    .join('\n\n');
}

/** The browser facts that shape which paths the highlighter can even take. */
export function environmentSummary() {
  const nav = globalThis.navigator || {};
  return [
    `agent: ${nav.userAgent || '—'}`,
    `touch points: ${nav.maxTouchPoints ?? '—'}`,
    `standalone: ${yesNo(globalThis.matchMedia?.('(display-mode: standalone)').matches)}`,
    `screen: ${globalThis.innerWidth}×${globalThis.innerHeight} @${globalThis.devicePixelRatio || 1}x`,
  ].join('\n');
}
