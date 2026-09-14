import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnQueue, animateScroll, swipeDirection, waitForPage, shouldAnimate } from '../src/lib/pageTurns.js';

test('rapid relative navigation resolves from the preceding settled page', async () => {
  const queue = createTurnQueue();
  let page = 1;
  const seen = [];
  await Promise.all([1, 1, -1].map((delta) => queue.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    page += delta;
    seen.push(page);
  })));
  assert.deepEqual(seen, [2, 3, 2]);
});

test('cancel aborts active work, discards queued work, and permits a fresh jump', async () => {
  const queue = createTurnQueue();
  const seen = [];
  const first = queue.run((signal) => new Promise((resolve) => {
    signal.addEventListener('abort', () => { seen.push('abort'); resolve(); });
  }));
  const stale = queue.run(() => seen.push('stale'));
  await Promise.resolve();
  queue.cancel();
  const jump = queue.run(() => seen.push('jump'));
  await Promise.all([first, stale, jump]);
  assert.deepEqual(seen, ['abort', 'jump']);
});

test('a failed rendering operation does not strand navigation', async () => {
  const queue = createTurnQueue();
  await assert.rejects(queue.run(() => { throw new Error('render'); }));
  assert.equal(await queue.run(() => 4), 4);
});

test('horizontal swipes exclude vertical movement, tiny drags and a different finger', () => {
  const start = { x: 200, y: 100, pointerId: 1 };
  assert.equal(swipeDirection(start, { clientX: 100, clientY: 105, pointerId: 1 }), 'next');
  assert.equal(swipeDirection(start, { clientX: 300, clientY: 105, pointerId: 1 }), 'prev');
  assert.equal(swipeDirection(start, { clientX: 190, clientY: 105, pointerId: 1 }), null);
  assert.equal(swipeDirection(start, { clientX: 100, clientY: 250, pointerId: 1 }), null);
  assert.equal(swipeDirection(start, { clientX: 100, clientY: 105, pointerId: 2 }), null);
  assert.equal(swipeDirection(null, { clientX: 100, clientY: 105, pointerId: 1 }), null);
});

test('render readiness handles ready, error, timeout and cancellation', async () => {
  const controller = new AbortController();
  await waitForPage(() => true, controller.signal);
  await assert.rejects(waitForPage(() => { throw new Error('bad PDF'); }, controller.signal), /bad PDF/);
  await assert.rejects(waitForPage(() => false, controller.signal, 1), /timed out/);
  const pending = waitForPage(() => false, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('animation cancellation lands on destination and releases scheduled frame', async () => {
  let callback;
  let canceled = false;
  globalThis.requestAnimationFrame = (fn) => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { canceled = true; };
  try {
    const element = { scrollLeft: 0, isConnected: true };
    const controller = new AbortController();
    const pending = animateScroll(element, 'scrollLeft', 390, controller.signal);
    callback(performance.now() + 100);
    assert.ok(element.scrollLeft > 0 && element.scrollLeft < 390);
    controller.abort();
    await pending;
    assert.equal(element.scrollLeft, 390);
    assert.equal(canceled, true);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});


test('animation setting, flow and current reduced-motion preference are all honored', () => {
  let reduced = false;
  globalThis.window = { matchMedia: () => ({ matches: reduced }) };
  try {
    assert.equal(shouldAnimate({ flow: 'paginated', pageAnimation: true }), true);
    assert.equal(shouldAnimate({ flow: 'paginated', pageAnimation: false }), false);
    assert.equal(shouldAnimate({ flow: 'scrolled', pageAnimation: true }), false);
    reduced = true;
    assert.equal(shouldAnimate({ flow: 'paginated', pageAnimation: true }), false);
  } finally { delete globalThis.window; }
});

test('disabled animation lands immediately without scheduling a frame', async () => {
  const element = { scrollLeft: 0, isConnected: true };
  await animateScroll(element, 'scrollLeft', 390, new AbortController().signal, false);
  assert.equal(element.scrollLeft, 390);
});
