/** How long a second tap has to arrive to count as part of the first. */
export const DOUBLE_TAP_MS = 400;

/**
 * Tells a single tap from a double one.
 *
 * Erasing a highlight used to happen on the first tap, which put a destructive
 * action under the lightest possible gesture — and next to a page turn and a
 * back button, both of which are also taps. Requiring two makes the intent
 * unambiguous.
 *
 * The single-tap action is therefore delayed by the length of the window: until
 * it closes there is no way to know which gesture this is. That cost is only
 * paid where the two compete, so a reader who leaves double-tap erasing off
 * never waits for anything.
 */
export function createTapArbiter(delay = DOUBLE_TAP_MS) {
  let pending = null; // { id, timer }

  const clear = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  };

  return {
    /**
     * Registers a tap on `id`. The second tap on the same thing inside the
     * window runs `onDouble` and the first tap's `onSingle` never happens; a
     * tap on anything else abandons whatever was waiting.
     */
    tap(id, { onSingle, onDouble }) {
      if (pending && pending.id === id) {
        clear();
        onDouble();
        return;
      }
      clear();
      const timer = setTimeout(() => {
        pending = null;
        onSingle();
      }, delay);
      pending = { id, timer };
    },
    cancel: clear,
  };
}
