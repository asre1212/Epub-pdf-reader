import { registerSW } from 'virtual:pwa-register';
import { getPref, setPref } from './db.js';

/**
 * Owns the service worker lifecycle for the whole app.
 *
 * The worker is registered in "prompt" mode: a new version installs and then
 * waits, so nothing reloads under the reader's feet. This module decides when
 * that waiting version is applied — automatically in the background, or when
 * the user presses Update.
 */

const AUTO_KEY = 'auto-update';
const POLL_INTERVAL = 60 * 60 * 1000; // hourly while the app is open
const REFOCUS_STALE_AFTER = 15 * 60 * 1000; // re-check on refocus at most this often
const INSTALL_TIMEOUT = 15000;
const APPLY_TIMEOUT = 8000;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null;

let state = {
  /** false in dev and in browsers without service workers — the UI says so. */
  supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  registered: false,
  /** a new version is installed and waiting to take over */
  needRefresh: false,
  /** the app's files are cached, so it opens without a connection */
  offlineReady: false,
  /** true only on the load where caching first completed, so it can be announced once */
  firstInstall: false,
  checking: false,
  applying: false,
  lastCheckedAt: null,
  error: null,
  autoUpdate: true,
};

const listeners = new Set();
let registration = null;
let updateSW = null;
let started = false;

function emit(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function subscribeToUpdates(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdateState() {
  return state;
}

/** Registers the worker and starts the background checks. Safe to call once. */
export function startUpdateWatch() {
  if (started) return;
  started = true;

  getPref(AUTO_KEY, true)
    .then((value) => emit({ autoUpdate: value !== false }))
    .catch(() => {});

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      emit({ needRefresh: true, checking: false, lastCheckedAt: Date.now() });
    },
    onOfflineReady() {
      // Fires only when the very first install finishes caching, which is the
      // one moment worth telling somebody about.
      emit({ offlineReady: true, firstInstall: true });
    },
    onRegisteredSW(_url, reg) {
      registration = reg || null;
      emit({
        registered: !!reg,
        offlineReady: state.offlineReady || !!reg?.active,
        needRefresh: state.needRefresh || !!reg?.waiting,
        lastCheckedAt: state.lastCheckedAt ?? Date.now(),
      });
      if (reg) {
        watchRegistration(reg);
        scheduleChecks();
      }
    },
    onRegisterError(error) {
      emit({ error: error?.message || 'The updater could not start.' });
    },
  });
}

/**
 * Watches the registration directly. A version can start installing because of
 * our own check, a browser-initiated one, or another tab — this notices all of
 * them. A waiting worker only counts as an update when something is already
 * controlling the page; otherwise it is just the first install finishing.
 */
function watchRegistration(reg) {
  const markReady = () => {
    if (reg.waiting && navigator.serviceWorker.controller) {
      emit({ needRefresh: true, checking: false, lastCheckedAt: Date.now() });
    }
  };

  markReady();
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') markReady();
    });
  });
}

function scheduleChecks() {
  setInterval(() => {
    checkForUpdate({ silent: true });
  }, POLL_INTERVAL);

  // Coming back to the app is the most likely moment for a new version to exist.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const age = Date.now() - (state.lastCheckedAt || 0);
    if (age > REFOCUS_STALE_AFTER) checkForUpdate({ silent: true });
  });

  window.addEventListener('online', () => checkForUpdate({ silent: true }));
}

/** Waits for a worker that just started installing to finish, up to a timeout. */
function waitForInstall(worker) {
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      worker.removeEventListener('statechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
        done();
      }
    };
    const timer = setTimeout(done, INSTALL_TIMEOUT);
    worker.addEventListener('statechange', onChange);
  });
}

/**
 * Asks the server whether a newer build exists. `silent` checks skip the error
 * state so a dropped connection does not nag someone reading offline.
 */
export async function checkForUpdate({ silent = false } = {}) {
  if (!registration) {
    if (!silent) emit({ error: 'Updates are only available in the installed app.' });
    return false;
  }
  if (state.checking) return false;

  emit({ checking: true, error: null });
  try {
    await registration.update();
    await waitForInstall(registration.installing);
    const waiting = !!registration.waiting;
    emit({
      checking: false,
      lastCheckedAt: Date.now(),
      needRefresh: state.needRefresh || waiting,
    });
    return waiting;
  } catch (err) {
    emit({
      checking: false,
      lastCheckedAt: Date.now(),
      error: silent ? null : err?.message || 'Could not reach the server.',
    });
    return false;
  }
}

let reloaded = false;

function reloadOnce() {
  if (reloaded) return;
  reloaded = true;
  window.location.reload();
}

/**
 * Hands over to the waiting version and reloads into it.
 *
 * The reload is driven from `controllerchange` here rather than left to the
 * registration helper: that one only reloads for updates it started itself, and
 * a version found by the browser or by another tab would otherwise install
 * without the page ever picking it up. The timeout covers a worker that
 * activates without ever taking control.
 */
export function applyUpdate() {
  if (state.applying) return;
  if (!state.needRefresh && !registration?.waiting) return;

  emit({ applying: true });
  navigator.serviceWorker?.addEventListener('controllerchange', reloadOnce, { once: true });
  setTimeout(reloadOnce, APPLY_TIMEOUT);

  if (updateSW) updateSW(true);
  else registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export async function setAutoUpdate(value) {
  emit({ autoUpdate: !!value });
  try {
    await setPref(AUTO_KEY, !!value);
  } catch {
    /* the toggle still applies for this session */
  }
}
