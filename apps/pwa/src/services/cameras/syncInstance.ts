/**
 * A HANDLE ON THE RUNNING CAMERA SYNC.
 *
 * `main.tsx` creates the one sync at boot. RADAR needs to reach it -- to widen
 * its tile ring when the driver zooms out -- and importing `main.tsx` to get it
 * drags the entire application bootstrap into every test that touches the radar
 * feature. It did, and thirty test files started failing with "#root is missing
 * from index.html": the shell was trying to mount itself inside a unit test.
 *
 * A screen must never import the shell. This is the seam: `main.tsx` puts the
 * instance in, features take it out, and neither knows about the other.
 *
 * NULL IS NORMAL. In a unit test nothing ever registers one, and a screen
 * asking to widen its coverage in that world should quietly do nothing rather
 * than explode -- widening the tile ring is an optimisation, not a promise.
 */

import type { CameraSync } from './sync.ts';

let instance: CameraSync | null = null;

/** Called once, from the shell. */
export function setCameraSync(sync: CameraSync): void {
  instance = sync;
}

/** The running sync, or null when nothing has registered one. */
export function getCameraSync(): CameraSync | null {
  return instance;
}

/**
 * Widen the tile ring to cover a range, if there is a sync to widen.
 *
 * The one thing callers actually want, wrapped so no screen has to null-check
 * a global it did not create.
 */
export function coverRangeFt(outerFt: number): void {
  instance?.coverRangeFt(outerFt);
}

/**
 * Fetch the tiles around a point, if there is a sync to ask.
 *
 * Called with the VIEW's centre rather than the vehicle's position: panning
 * moves the window over the world, and a map loads what the viewer is looking
 * at. The sync already skips tiles it holds, so calling this as a pan settles
 * costs nothing for ground already covered.
 */
export function syncCamerasAt(lat: number, lon: number): void {
  void instance?.syncAt(lat, lon);
}
