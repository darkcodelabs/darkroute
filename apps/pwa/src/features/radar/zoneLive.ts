/**
 * THE LIVE ZONE - what ZONE AUDIT says, computed for where you are now.
 *
 * ZONE AUDIT (B6) is a screen you go to. This is the same reading, small,
 * under the dial, updating as you drive - the answer to "what am I actually
 * in the middle of" without leaving RADAR.
 *
 * IT IS THE SAME NUMBERS, NOT A SECOND OPINION.
 *   The owner classes are `zone.ts`'s own rows, in its order: police-owned,
 *   HOA/private, and what is left. If these two ever disagree the product has
 *   two answers to one question, and a driver has no way to know which is the
 *   real one.
 *
 * WHAT IS COUNTED, AND FROM WHERE
 *   Every cached camera within the radius - not just the ones the alert engine
 *   assessed. The engine looks at what it must to decide an alert; this
 *   describes the area, and a camera behind you is still watching the road you
 *   are on.
 *
 * MUTED CAMERAS STILL COUNT.
 *   Muting removes the alert, never the record. A zone reading that quietly
 *   shrank because you silenced something would be the app helping you
 *   misunderstand where you are.
 */

import type { CameraRecord } from '../../services/db/schema.ts';
import { metresBetween } from '../../services/cameras/sync.ts';
import { AREA_RADIUS_M, AREA_RADIUS_MI } from '../../services/cameras/watchedArea.ts';

export interface ZoneLive {
  /** Cameras within {@link AREA_RADIUS_MI}. */
  readonly total: number;
  readonly police: number;
  readonly hoaPrivate: number;
  /** OSM records `operator` on about 1 in 6 nodes; the rest are honestly unknown. */
  readonly unverified: number;
  /** The place the vehicle's nearest cameras sit in, or null. */
  readonly placeGeoid: string | null;
  readonly countyFips: string | null;
  readonly radiusMi: number;
}

export const EMPTY_ZONE: ZoneLive = Object.freeze({
  total: 0,
  police: 0,
  hoaPrivate: 0,
  unverified: 0,
  placeGeoid: null,
  countyFips: null,
  radiusMi: AREA_RADIUS_MI,
});

/**
 * The most common value in a list, or null when the list is empty.
 *
 * Used for the place and county labels: the zone is named after where MOST of
 * its cameras are, not after the single nearest one. On a boundary the nearest
 * camera can be across a line from everything else, and naming the zone after
 * it would flip the label back and forth as you drive.
 */
function commonest(values: readonly (string | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function zoneLive(
  at: { lat: number; lon: number } | null,
  cameras: readonly CameraRecord[],
  radiusM: number = AREA_RADIUS_M,
): ZoneLive {
  if (at === null) return EMPTY_ZONE;

  const inside: CameraRecord[] = [];
  for (const camera of cameras) {
    if (metresBetween(at, camera) <= radiusM) inside.push(camera);
  }
  if (inside.length === 0) return EMPTY_ZONE;

  let police = 0;
  let hoaPrivate = 0;
  let unverified = 0;
  for (const camera of inside) {
    switch (camera.ownerType) {
      case 'police':
      case 'inter_agency':
        police += 1;
        break;
      case 'hoa':
      case 'private':
        hoaPrivate += 1;
        break;
      default:
        unverified += 1;
        break;
    }
  }

  return Object.freeze({
    total: inside.length,
    police,
    hoaPrivate,
    unverified,
    placeGeoid: commonest(inside.map((c) => c.placeGeoid)),
    countyFips: commonest(inside.map((c) => c.countyFips)),
    radiusMi: Math.round((radiusM / 1609.344) * 10) / 10,
  });
}
