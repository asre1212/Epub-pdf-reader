import { useEffect, useState } from 'react';
import { generateSyncCode, normaliseSyncCode } from '../lib/syncCrypto.js';
import {
  checkServer,
  forgetOnServer,
  getSyncConfig,
  getSyncState,
  resetSyncState,
  saveSyncConfig,
  syncNow,
} from '../lib/sync.js';
import { copyToClipboard } from '../lib/exportNotes.js';

/** "Everything was up to date" is wrong when this device just sent something. */
function summarise(result) {
  const parts = [];
  if (result.applied) parts.push(`${result.applied} brought in`);
  if (result.pushed) parts.push(`${result.pushed} sent`);
  return parts.length ? `Synced — ${parts.join(', ')}` : 'Synced. Everything was already up to date.';
}

function ago(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'} ago`;
}

export default function SyncSheet({ notify, onSynced, onClose }) {
  const [config, setConfig] = useState(null);
  const [state, setState] = useState(null);
  const [endpoint, setEndpoint] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState('idle'); // idle | join
  const [busy, setBusy] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const reload = async () => {
    const [nextConfig, nextState] = await Promise.all([getSyncConfig(), getSyncState()]);
    setConfig(nextConfig);
    setState(nextState);
    setEndpoint((current) => current || nextConfig.endpoint);
  };

  useEffect(() => {
    reload();
  }, []);

  if (!config) return null;
  const connected = config.enabled && config.code && config.endpoint;

  const withServer = async (run) => {
    const address = endpoint.trim();
    if (!address) {
      notify('Enter the address of your sync worker first.', 'error');
      return false;
    }
    try {
      await checkServer(address);
    } catch (err) {
      notify(err?.message || 'Could not reach that address.', 'error');
      return false;
    }
    await run(address);
    return true;
  };

  const startFresh = async () => {
    setBusy('start');
    try {
      await withServer(async (address) => {
        const code = generateSyncCode();
        await resetSyncState();
        setConfig(await saveSyncConfig({ enabled: true, endpoint: address, code }));
        setRevealed(true);
        const result = await syncNow({ force: true });
        await reload();
        notify(result.ok ? 'Syncing is on. Enter the code on your other device.' : result.error, result.ok ? 'success' : 'error');
        onSynced?.();
      });
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    const code = normaliseSyncCode(joinCode);
    if (!code) {
      notify('That code does not look right — it is five groups of five.', 'error');
      return;
    }
    setBusy('join');
    try {
      await withServer(async (address) => {
        await resetSyncState();
        setConfig(await saveSyncConfig({ enabled: true, endpoint: address, code }));
        const result = await syncNow({ force: true });
        await reload();
        if (result.ok) {
          notify(
            result.applied
              ? `Connected — brought in ${result.applied} change${result.applied === 1 ? '' : 's'}`
              : 'Connected. Nothing to bring in yet.',
            'success',
          );
          setMode('idle');
          setJoinCode('');
          onSynced?.();
        } else {
          notify(result.error || 'Could not sync.', 'error');
        }
      });
    } finally {
      setBusy(null);
    }
  };

  const runSync = async () => {
    setBusy('sync');
    try {
      const result = await syncNow({ force: true });
      await reload();
      if (result.ok) {
        notify(summarise(result), 'success');
        onSynced?.();
      } else {
        notify(result.error || 'Could not sync.', 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Stop syncing on this device? Your books and highlights stay here.')) return;
    await saveSyncConfig({ enabled: false });
    await resetSyncState();
    await reload();
    notify('Sync turned off on this device.');
  };

  const wipe = async () => {
    if (!window.confirm('Delete everything this code has stored on the server? Your devices keep their own copies.')) {
      return;
    }
    setBusy('wipe');
    try {
      const result = await forgetOnServer();
      await reload();
      notify(result.ok ? 'Server copy deleted.' : result.error || 'Could not reach the server.', result.ok ? 'success' : 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Sync across devices"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">Sync across devices</h2>
        <p className="set-hint">
          Keeps your place in each book and your highlights in step between your phone and tablet.
          Everything is encrypted on the device first, so the server only ever holds scrambled text —
          it cannot see your books, your notes, or how far through you are. Book files are not
          uploaded; the same file on both devices is matched by its content.
        </p>

        <div className="set-row">
          <div className="set-label">
            <span>Sync worker address</span>
          </div>
          <input
            type="url"
            className="field"
            placeholder="https://marginalia-sync.your-name.workers.dev"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={connected}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {!connected && (
            <p className="set-hint">
              Deploy <code>worker/</code> to your Cloudflare account and paste the URL it prints.
            </p>
          )}
        </div>

        {connected ? (
          <>
            <div className="set-row">
              <div className="set-label">
                <span>Your sync code</span>
                <button type="button" className="link" onClick={() => setRevealed((v) => !v)}>
                  {revealed ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="synccode">{revealed ? config.code : '•••••-•••••-•••••-•••••-•••••'}</p>
              <p className="set-hint">
                Enter this on your other device to pair them. Anyone with this code can read your
                highlights, so treat it like a password.
              </p>
              <div className="about-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const done = await copyToClipboard(config.code);
                    notify(done ? 'Code copied' : 'Could not copy', done ? 'success' : 'error');
                  }}
                >
                  Copy code
                </button>
                <button type="button" className="btn btn-primary" onClick={runSync} disabled={busy === 'sync'}>
                  {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
            </div>

            <div className="set-row">
              <div className="set-label">
                <span>Status</span>
                <span className="set-value">{ago(state?.lastSyncAt)}</span>
              </div>
              {state?.lastError ? (
                <p className="set-hint is-error">{state.lastError}</p>
              ) : (
                <p className="set-hint">
                  Syncs when the app opens, when you come back to it, and shortly after you highlight
                  something or move through a book.
                </p>
              )}
              <div className="about-actions">
                <button type="button" className="btn" onClick={disconnect}>
                  Turn off here
                </button>
                <button type="button" className="btn" onClick={wipe} disabled={busy === 'wipe'}>
                  Delete server copy
                </button>
              </div>
            </div>
          </>
        ) : mode === 'join' ? (
          <div className="set-row">
            <div className="set-label">
              <span>Code from your other device</span>
            </div>
            <input
              type="text"
              className="field synccode-input"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
            />
            <div className="about-actions">
              <button type="button" className="btn btn-primary" onClick={join} disabled={busy === 'join'}>
                {busy === 'join' ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="set-row">
            <div className="about-actions">
              <button type="button" className="btn btn-primary" onClick={startFresh} disabled={busy === 'start'}>
                {busy === 'start' ? 'Setting up…' : 'Start syncing'}
              </button>
              <button type="button" className="btn" onClick={() => setMode('join')}>
                I have a code
              </button>
            </div>
            <p className="set-hint">
              Start on the device that already has your reading history, then enter its code on the
              other one.
            </p>
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
