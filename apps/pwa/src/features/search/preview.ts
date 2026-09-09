/**
 * 3 · PICKED -- the route preview, as data.
 *
 * `DarkRoute Search Entry.html`, section B, state 3: "Up to three routes,
 * fewest-cameras first -- this app defaults to exposure, not speed. Nothing is
 * saved to history until a route starts." The panel draws whatever
 * `RouteOption`s it is handed; this is where a host turns two planned lines
 * into those rows, and what it hands over when it could not plan at all.
 *
 * TWO OPTIONS, NOT THREE. The spec's third row, "Avoid abuse areas", needs a
 * router that takes a documented-misuse polygon as an exclusion, and the
 * routing Function takes camera exclusions only. Drawing the row with a dash
 * would be offering a route nobody can plan; "up to three" is the spec's own
 * allowance for this. GAP: search-panel / avoid-abuse-has-no-router
 *
 * NEVER AN EMPTY PREVIEW. A PICKED state with no rows is a state the driver
 * cannot leave except by typing again, so a failed or fix-less preview still
 * yields one fewest-cameras row with an honest detail line and an unknown
 * count. Starting it plans for real, from the press, exactly as before.
 */

import type { CameraRecord } from '../../services/db/schema.ts';
import { camerasOnRoute } from '../../services/route/corridor.ts';
import type { DarkRoute } from '../../services/route/darkRoute.ts';
import type { PlannedRoute } from '../../services/route/planRoute.ts';

import { COUNT_UNKNOWN, counted, driveSub } from './panel.ts';
import type { RouteOption } from './panel.ts';

/** Said in the one row a preview draws when there is no fix to plan from. */
export const PREVIEW_NO_FIX = 'no fix yet · starts when there is one';

/** Said in the one row a preview draws when neither route could be planned. */
export const PREVIEW_FAILED = 'could not be previewed · start anyway';

/**
 * The rows for a picked destination: fewest cameras first, then fastest.
 *
 * The fewest-cameras count is the readers STILL on the dark line -- `remaining`,
 * which the dark-route planner reports honestly rather than claiming a clear
 * road. The fastest count is measured on the phone against the archive it
 * holds, the same way the row counts above the preview are.
 */
export function routeOptionsFrom(
  plain: PlannedRoute | null,
  dark: DarkRoute | null,
  cameras: readonly CameraRecord[],
): readonly RouteOption[] {
  const out: RouteOption[] = [];
  if (dark !== null) {
    out.push({
      kind: 'fewest-cameras',
      detail: driveSub({ minutes: dark.route.seconds / 60, miles: dark.route.miles }),
      count: counted(dark.remaining.length),
    });
  }
  if (plain !== null) {
    out.push({
      kind: 'fastest',
      detail: driveSub({ minutes: plain.seconds / 60, miles: plain.miles }),
      count: counted(camerasOnRoute(plain.shape, cameras).length),
    });
  }
  if (out.length === 0) {
    out.push({ kind: 'fewest-cameras', detail: PREVIEW_FAILED, count: COUNT_UNKNOWN });
  }
  return out;
}

/** The preview when there is no position to plan from. One row, startable. */
export function previewWithoutFix(): readonly RouteOption[] {
  return [{ kind: 'fewest-cameras', detail: PREVIEW_NO_FIX, count: COUNT_UNKNOWN }];
}
