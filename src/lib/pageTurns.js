// Navigation owns one abortable operation at a time. Callers resolve relative
// destinations inside the queue, never from a stale React render.
export function createTurnQueue() {
  let tail = Promise.resolve();
  let generation = 0;
  let active;
  return {
    run(task) {
      const version = generation;
      const result = tail.then(async () => {
        if (version !== generation) return;
        const controller = new AbortController();
        active = controller;
        try { return await task(controller.signal); }
        finally { if (active === controller) active = undefined; }
      });
      tail = result.catch(() => {});
      return result;
    },
    cancel() { generation += 1; active?.abort(); },
  };
}

export function shouldAnimate(settings) {
  return settings.flow === 'paginated' && settings.pageAnimation !== false &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Animate the actual scroll position: no iframe opacity or ancestor transforms.
// Cancellation lands on a real page before a resize, jump, or next operation.
export function animateScroll(element, property, destination, signal, animate = true) {
  if (signal.aborted || !element.isConnected) return Promise.resolve();
  const from = element[property];
  if (!animate || Math.abs(destination - from) < 1) {
    element[property] = destination;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let frame;
    const start = performance.now();
    const finish = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', finish);
      if (element.isConnected) element[property] = destination;
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    const step = (now) => {
      if (!element.isConnected) return finish();
      const t = Math.min(1, (now - start) / 280);
      element[property] = from + (destination - from) * (1 - (1 - t) ** 3);
      if (t === 1) finish();
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  });
}

export function waitForPage(check, signal, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let timer;
    const started = performance.now();
    const finish = (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('Navigation cancelled', 'AbortError'));
    const poll = () => {
      if (signal.aborted) return abort();
      try {
        if (check()) return finish();
        if (performance.now() - started > timeout) return finish(new Error('Page rendering timed out'));
      } catch (error) { return finish(error); }
      timer = setTimeout(poll, 16);
    };
    signal.addEventListener('abort', abort, { once: true });
    poll();
  });
}

export function swipeDirection(start, end) {
  if (!start || end.pointerId !== start.pointerId) return null;
  const dx = end.clientX - start.x;
  const dy = end.clientY - start.y;
  return Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4
    ? (dx < 0 ? 'next' : 'prev') : null;
}
