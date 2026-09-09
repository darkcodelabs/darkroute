/**
 * THE PUBLISHED CAMERA COUNT, AS REACT STATE.
 *
 * `catalogue.total()` is a plain getter over a value that arrives
 * asynchronously. Calling it during render is correct and useless on its own:
 * the first render reads `null`, the read lands a moment later, and nothing
 * schedules another render - so the screen keeps drawing the absence forever.
 *
 * DRIVE's header did exactly that. It drew "1k" alone on every cold start and
 * only became "1k / 140k" when something else happened to re-render it, which
 * on the first-run path is nothing. A bare figure is the ambiguity the
 * catalogue's own docstring exists to prevent: it could mean the network knows
 * about 987 cameras, or that this phone holds 987 of a much larger set.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`: the value lives
 * outside React and is shared by every screen that asks, so the store IS the
 * source and copying it into component state would make a second one.
 */

import { useSyncExternalStore } from 'react';

import { catalogue } from './catalogue.ts';

/** How many cameras the published archive holds, or null while unknown. */
export function useCatalogueTotal(): number | null {
  return useSyncExternalStore(
    (listener) => catalogue.subscribe(listener),
    () => catalogue.total(),
    // Server snapshot. There is no server render, but the signature wants one
    // and `null` is the honest answer for a render with no browser behind it.
    () => null,
  );
}
