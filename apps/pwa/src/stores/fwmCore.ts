/**
 * THE ONE PLACE `@fwm/core` IS WIRED INTO THE STORES.
 *
 * `packages/core` owns every derived geospatial value in this product: distance,
 * bearing, relative direction, slippy-tile addressing and the alert state
 * machine. A store must never recompute any of that - it holds the ENGINE'S
 * INPUTS and caches the ENGINE'S OUTPUTS, and nothing in `src/stores` is
 * allowed to do arithmetic on a coordinate. Importing the engine here, once,
 * is what makes that rule checkable: `grep -L fwmCore src/stores/*.ts` is the
 * list of files that cannot possibly be doing geodesy.
 *
 * WHY A RELATIVE PATH AND NOT THE PACKAGE NAME
 *
 * `@fwm/core` is still absent from `apps/pwa/package.json`, so the specifier
 * does not resolve and adding it means touching a manifest and a lockfile,
 * which is not this module's call to make. `services/simulator/fwmCore.ts`
 * made the same call for the simulator and the fixtures; this is the stores'
 * copy of that decision rather than a reach into the simulator, because
 * production state must not import a development tool. When the dependency
 * lands, BOTH files collapse to:
 *
 *     export * from '@fwm/core';
 *
 * `export *` rather than a hand-maintained list: a re-export that has to be
 * maintained goes stale, and a stale one hides an engine constant from the
 * store that is supposed to be caching it.
 */

export * from '../../../../packages/core/src/index.ts';
