/**
 * THE MAP ANGLE - looking straight down, or looking along the road.
 *
 * =============================================================================
 * WHY A CAR MAP TILTS
 * =============================================================================
 * Top-down is a map of where you ARE. Tilted is a picture of where you are
 * GOING: the ground ahead takes most of the screen, the ground behind collapses
 * to a strip, and distance up the screen means distance up the road. Every
 * turn-by-turn product on the phone does this, and it is not decoration - it is
 * what makes "the next one is 900 ft ahead" something you can see rather than
 * read.
 *
 * Top-down stays the default and stays one tap away. It is the better view when
 * the question is "how many are around me" rather than "what is coming", it is
 * the only honest one when the app has no heading to point the camera along, and
 * it draws fewer tiles.
 *
 * =============================================================================
 * WHY NOT FREE PITCH
 * =============================================================================
 * MapLibre's own pitch gesture is a two-finger vertical drag, and it is left
 * OFF, along with rotate. A driver braced against a moving car does not
 * reliably produce a two-finger drag on purpose, and the failure mode is a map
 * at some arbitrary angle they did not choose and cannot easily undo. Two named
 * angles on a button are recoverable; a continuous gesture is not.
 *
 * =============================================================================
 * WHY 55 AND NOT MORE
 * =============================================================================
 * Past about 60 degrees the horizon enters the frame, labels at the top of the
 * screen compress into an unreadable band, and MapLibre has to draw far-field
 * tiles that are two pixels tall - real GPU cost for ground the driver will
 * reach in ten minutes. 55 keeps the horizon just off screen.
 */

export const FWM_MAP_TILTS = ['flat', 'angled'] as const;

export type FwmMapTilt = (typeof FWM_MAP_TILTS)[number];

/**
 * ANGLED, by owner decision. Top-down was the default while the pitched camera
 * was new; the driving view is the pitched one, so that is what a first launch
 * gets. Flat stays in the picker.
 */
export const DEFAULT_MAP_TILT: FwmMapTilt = 'angled';

/**
 * The angle each one means, in degrees off vertical.
 *
 * `maxPitch` on the map is set from the largest of these, so adding a steeper
 * entry here is enough to make it reachable.
 */
export const MAP_TILT_DEG: Readonly<Record<FwmMapTilt, number>> = Object.freeze({
  flat: 0,
  angled: 55,
});

export const MAP_TILT_LABELS: Readonly<Record<FwmMapTilt, string>> = Object.freeze({
  flat: 'Top down',
  angled: 'Angled',
});

export const MAP_TILT_NOTES: Readonly<Record<FwmMapTilt, string>> = Object.freeze({
  flat: 'straight down. the whole ring around you at once, and the fewest tiles to draw.',
  angled: 'tilted along the road, the way a turn-by-turn map sits. the ground ahead gets most of the screen.',
});

export function isMapTilt(value: unknown): value is FwmMapTilt {
  return typeof value === 'string' && (FWM_MAP_TILTS as readonly string[]).includes(value);
}

export function resolveMapTilt(value: unknown): FwmMapTilt {
  return isMapTilt(value) ? value : DEFAULT_MAP_TILT;
}

/** The steepest angle any setting can ask for, which is what the map allows. */
export function maxTiltDeg(): number {
  return Math.max(...Object.values(MAP_TILT_DEG));
}

export function nextMapTilt(tilt: FwmMapTilt): FwmMapTilt {
  const at = FWM_MAP_TILTS.indexOf(tilt);
  return FWM_MAP_TILTS[(at + 1) % FWM_MAP_TILTS.length] ?? DEFAULT_MAP_TILT;
}
