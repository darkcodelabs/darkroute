/**
 * THE ONE PLACE `@fwm/core` IS WIRED INTO THE PWA.
 *
 * `packages/core` is the proximity + alert engine: the geodesy, the slippy-tile
 * addressing, the injected clock and the alert state machine. The simulator and
 * the fixtures must drive THAT engine - not a copy of it - or a passing
 * simulated drive proves nothing about the shipped one.
 *
 * WHY A RELATIVE PATH AND NOT THE PACKAGE NAME
 *
 * `@fwm/core` is not yet a dependency of `@fwm/pwa`: it is absent from
 * `apps/pwa/package.json` and there is no `apps/pwa/node_modules/@fwm` link, so
 * the specifier does not resolve. Adding the dependency means touching a
 * manifest and a lockfile, which is not this module's call to make. Until then
 * the workspace path below is the honest way in, and it is written down ONCE so
 * that wiring the dependency up later is a one-line edit here and nothing else:
 *
 *     export * from '@fwm/core';
 *
 * Nothing else under `apps/pwa/src/services/simulator` or
 * `apps/pwa/src/test/fixtures` may reach across the workspace directly. Import
 * from this module instead.
 *
 * `export *` rather than a hand-written list: a re-export that has to be
 * maintained is a re-export that goes stale, and a stale one silently hides an
 * engine constant from the simulator that is supposed to be exercising it.
 */

export * from '../../../../../packages/core/src/index.ts';
