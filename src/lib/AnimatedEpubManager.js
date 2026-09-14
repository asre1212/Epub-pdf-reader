import ContinuousViewManager from 'epubjs/src/managers/continuous/index.js';
import { animateScroll } from './pageTurns.js';

// Keep the chapter on each side painted, including at spine boundaries. During
// movement, suppress automatic trimming and background preloading, since either
// can move the coordinate origin while the animation is using it.
export default class AnimatedEpubManager extends ContinuousViewManager {
  check(...args) {
    return this.turning ? Promise.resolve(false) : super.check(...args);
  }
  update(...args) {
    return this.turning ? Promise.resolve() : super.update(...args);
  }
  trim(...args) {
    return this.turning ? Promise.resolve() : super.trim(...args);
  }
  async turn(direction, signal, animate) {
    const element = this.container;
    if (!element || signal.aborted) return;
    const buffer = Math.max(element.clientWidth, element.clientHeight) * 2;
    this.settings.offset = buffer;
    await this.q.enqueue(() => this.check(buffer, buffer));
    await this.q.enqueue(() => this.update(buffer));
    if (signal.aborted || !element.isConnected) return;
    const horizontal = this.settings.axis === 'horizontal';
    const property = horizontal ? 'scrollLeft' : 'scrollTop';
    const delta = horizontal ? this.layout.delta : this.layout.height;
    const sign = (direction === 'next' ? 1 : -1) *
      (horizontal && this.settings.direction === 'rtl' ? -1 : 1);
    const max = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    const negative = horizontal && this.settings.direction === 'rtl' && this.settings.rtlScrollType === 'negative';
    const destination = Math.max(negative ? -max : 0,
      Math.min(negative ? 0 : max, element[property] + sign * delta));
    this.turning = true;
    try {
      await animateScroll(element, property, destination, signal, animate);
    } finally {
      this.turning = false;
      this.scrollLeft = element.scrollLeft;
      this.scrollTop = element.scrollTop;
    }
  }
}
