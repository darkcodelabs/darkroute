/** Events MapLibre can emit while an initial style becomes usable. */
export type StyleReadyEvent = 'styledata' | 'load' | 'render' | 'idle';

/** The small MapLibre surface needed to wait for a usable style. */
export interface StyleReadyTarget {
  // MapLibre's declaration may return no value while no style exists yet.
  isStyleLoaded(): unknown;
  on(event: StyleReadyEvent, listener: () => void): unknown;
  off(event: StyleReadyEvent, listener: () => void): unknown;
}

export interface StyleReadyOptions {
  readonly pollMs?: number;
  readonly timeoutMs?: number;
}

const READY_EVENTS: readonly StyleReadyEvent[] = ['styledata', 'load', 'render', 'idle'];

/**
 * Run once when a MapLibre style is usable, even if its top-level `load` event
 * never arrives because one initial source failed.
 *
 * MapLibre can finish constructing a style while a malformed tile keeps the
 * aggregate `load` event pending forever. Waiting only for `load` then prevents
 * unrelated application sources and layers from ever being installed. The
 * event listeners make the normal path immediate; bounded polling covers the
 * stalled-source case without leaving a permanent timer behind.
 */
export function whenStyleReady(
  target: StyleReadyTarget,
  onReady: () => void,
  options: StyleReadyOptions = {},
): () => void {
  const pollMs = options.pollMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispose = (): void => {
    if (!active) return;
    active = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const event of READY_EVENTS) target.off(event, check);
  };

  const check = (): void => {
    if (!active) return;
    if (target.isStyleLoaded() === true) {
      dispose();
      onReady();
      return;
    }
    // Stop the active poll at the deadline, but retain the event listeners.
    // A slow source may make the style usable at 30.1 seconds; giving up here
    // would permanently suppress application layers for the rest of the map's
    // lifetime. `dispose()` on map cleanup owns those passive listeners.
    if (Date.now() >= deadline) return;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        check();
      }, pollMs);
    }
  };

  for (const event of READY_EVENTS) target.on(event, check);
  check();
  return dispose;
}
