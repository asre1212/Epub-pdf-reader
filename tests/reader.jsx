// Development-only integration harness. Vite does not include it in the build.
import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import EpubView from '../src/components/EpubView.jsx';
import PdfView from '../src/components/PdfView.jsx';
import SettingsSheet from '../src/components/SettingsSheet.jsx';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import '../src/styles.css';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (value, message) => { if (!value) throw new Error(message); };
const noop = () => {};
const book = { id: 'turn-regression', location: null };
const empty = [];
function Harness() {
  const [format, setFormat] = useState('epub');
  const [blob, setBlob] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [width, setWidth] = useState(390);
  const [logs, setLogs] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [meta, setMeta] = useState({});
  const metaRef = useRef({});
  const progressRef = useRef({});
  const view = useRef();
  const add = (text) => setLogs((old) => [...old, text]);
  const onMeta = React.useCallback((value) => {
    metaRef.current = { ...metaRef.current, ...value };
    setMeta(metaRef.current);
  }, []);
  const onProgress = React.useCallback((id, value) => { progressRef.current = value; }, []);
  const notify = React.useCallback((text) => setLogs((old) => [...old, `NOTICE: ${text}`]), []);
  async function load(type) {
    setBlob(null);
    setFormat(type);
    setSettings(DEFAULT_SETTINGS);
    metaRef.current = {};
    setLogs([]);
    const response = await fetch(`/tests/fixtures/book.${type}`);
    check(response.ok, 'Fixture missing');
    setBlob(await response.blob());
  }
  async function run() {
    try {
      check(view.current, 'Load a fixture first');
      if (format === 'pdf') {
        await view.current.goTo(1);
        check(metaRef.current.page === 1, 'PDF starts on page 1');
        const scroll = document.querySelector('.pdf-horizontal');
        let samples = [];
        const timer = setInterval(() => samples.push(scroll.scrollLeft), 16);
        await view.current.next();
        clearInterval(timer);
        check(metaRef.current.page === 2, 'PDF next settles on page 2');
        check(new Set(samples.map(Math.round)).size > 3, 'PDF scroll must visibly animate');
        check(document.querySelector('.pdf-page[data-page="2"]').dataset.renderScale, 'Incoming PDF was rendered');
        add('PASS PDF rendered incoming page and animated through intermediate positions');
        await Promise.all([view.current.next(), view.current.next(), view.current.prev()]);
        check(metaRef.current.page === 3, 'Rapid PDF turns preserve +1,+1,-1 order');
        check(progressRef.current.location === 3, 'PDF saved settled location');
        add('PASS PDF rapid turns and saved location');
        await view.current.goTo(metaRef.current.numPages);
        await view.current.next();
        check(metaRef.current.page === metaRef.current.numPages, 'PDF end clamp');
        await view.current.goTo(1);
        await view.current.prev();
        check(metaRef.current.page === 1, 'PDF start clamp');
        add('PASS PDF first/last page boundaries and long jumps');
      } else {
        const scroll = document.querySelector('.epub-container');
        const before = progressRef.current.location;
        let samples = [];
        const timer = setInterval(() => samples.push(scroll.scrollLeft), 16);
        await view.current.next();
        clearInterval(timer);
        check(progressRef.current.location !== before, 'EPUB location advanced');
        check(new Set(samples.map(Math.round)).size > 3, 'EPUB scroll must visibly animate');
        add('PASS EPUB scroll animation and saved CFI');
        await view.current.goTo('c2.xhtml');
        await pause(150);
        check(metaRef.current.chapter === 'Chapter 2', 'Jump to chapter 2');
        await view.current.prev();
        check(metaRef.current.chapter === 'Chapter 1', 'Backward chapter boundary');
        await view.current.next();
        check(metaRef.current.chapter === 'Chapter 2', 'Forward chapter boundary');
        add('PASS EPUB forward and backward chapter boundaries');
        const start = progressRef.current.location;
        await Promise.all([view.current.next(), view.current.next(), view.current.prev(), view.current.prev()]);
        check(progressRef.current.location === start, 'Rapid EPUB turns return to same CFI');
        add('PASS EPUB rapid turns preserve order');
      }
      add('ALL CORE CHECKS PASSED');
    } catch (error) { add(`FAIL ${error.stack}`); }
  }
  const View = format === 'epub' ? EpubView : PdfView;
  return <>
    <header style={{ padding: 12, position: 'relative', zIndex: 100, background: '#eee', color: '#111' }}>
      <button onClick={() => load('epub')}>Load EPUB</button>{' '}
      <button onClick={() => load('pdf')}>Load PDF</button>{' '}
      <button onClick={run}>Run core checks</button>{' '}
      <button onClick={() => view.current?.prev()}>Previous</button>{' '}
      <button onClick={() => view.current?.next()}>Next</button>{' '}
      <button onClick={() => setWidth((old) => old === 390 ? 650 : 390)}>Rotate viewport</button>{' '}
      <button onClick={() => setSheet(true)}>Settings</button>
      <pre aria-label="Reader position">{JSON.stringify(meta)}</pre>
    </header>
    <div className="reader-stage" style={{ position: 'relative', width, height: 660, background: '#f6ecd9', color: '#453a29' }}>
      {blob && <View key={format} ref={view} blob={blob} book={book} settings={settings}
        highlights={empty} onMeta={onMeta} onProgress={onProgress} notify={notify}
        onCreateHighlight={noop} onUpdateHighlight={noop} onDeleteHighlight={noop} onUndeleteHighlight={noop}
        onToggleChrome={noop} highlighterOn={false} />}
    </div>
    <pre aria-label="Test results" style={{ position: 'absolute', left: 670, top: 160, whiteSpace: 'pre-wrap', color: '#111', background: '#eee', padding: 12 }}>{logs.join('\n')}</pre>
    {sheet && <SettingsSheet format={format} settings={settings} onChange={(patch) => setSettings((old) => ({ ...old, ...patch }))} onClose={() => setSheet(false)} />}
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
