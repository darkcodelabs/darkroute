/**
 * THE WHOLE-COUNTRY OVERVIEW - every published camera as a bare coordinate.
 *
 * `overview.json` is written alongside the tiles by `scripts/fetch-cameras.mjs`
 * and carries `coords` as a flat `[lat, lon, lat, lon, ...]` list plus the ODbL
 * notice. Two screens want it and they want it for different reasons:
 *
 *   MAP     below z11 the near-field tiles are meaningless - a 15 km square is
 *           a pixel - so the map swaps its source for this set to show the
 *           SHAPE of the published archive.
 *   DOCS    the POI export builds a GPX/CSV/OV2 file from the same coordinates,
 *           so a driver can carry the archive into another device.
 *
 * =============================================================================
 * WHY IT IS ONE MODULE AND NOT TWO FETCHES
 * =============================================================================
 * It was two: `MapCanvas.tsx` and `DocsScreen.tsx` each called
 * `fetch('/cameras/overview.json')` raw - no generation query, no header check,
 * not even `guardedFetch`, so an Access bounce was indistinguishable from data.
 * Two unbound readers of a file that is republished on every generation is two
 * chances to draw one snapshot's dots over another snapshot's warnings, and the
 * two could disagree with each other as well.
 *
 * One generation-bound resource (`sidecar.ts`) answers both. The comment in
 * `DocsScreen.tsx` that said the export "reads bytes that are on the device"
 * because the map already fetched them and the worker already holds them is now
 * TRUE: both go through this URL, and the service worker has a route for it.
 *
 * =============================================================================
 * WHAT A FAILURE MEANS
 * =============================================================================
 * `null`. A missing overview is a thinner map and an export that says it could
 * not read the archive; it is never a warning that does not happen, because
 * nothing on the alert path reads this file. When there is no working camera
 * generation at all there is nothing to be an overview OF - the app has no
 * tiles either - and this stays null rather than drawing a hundred thousand
 * unbacked dots.
 */

import { createGenerationBoundResource } from './sidecar.ts';
import type { GenerationBoundResource } from './sidecar.ts';

export interface CameraOverview {
  /** Flat `[lat, lon, lat, lon, ...]`, exactly as the file stores it. */
  readonly coords: readonly number[];
  /** ODbL requires this wherever the points are rendered. */
  readonly attribution: string | null;
  readonly licence: string | null;
}

function parseOverview(body: unknown): CameraOverview {
  const record = body as {
    coords?: unknown;
    attribution?: unknown;
    licence?: unknown;
  } | null;
  const coords = Array.isArray(record?.coords) ? (record.coords as number[]) : null;
  // An overview with no coordinates is a damaged generation, not an empty
  // country. Refusing it here keeps "unknown" and "there are no cameras"
  // distinguishable on both screens that read it.
  if (coords === null || coords.length === 0) throw new Error('overview: no coordinates');
  return {
    coords,
    attribution: typeof record?.attribution === 'string' ? record.attribution : null,
    licence: typeof record?.licence === 'string' ? record.licence : null,
  };
}

export function createCameraOverview(
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly base?: string;
    readonly workingGeneration?: () => string | null;
  } = {},
): GenerationBoundResource<CameraOverview> {
  return createGenerationBoundResource({
    ...options,
    path: 'overview.json',
    parse: parseOverview,
  });
}

/** The app's one overview. Both screens read the archive through this. */
export const cameraOverview: GenerationBoundResource<CameraOverview> = createCameraOverview();
