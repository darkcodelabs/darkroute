/**
 * PINCH TO ZOOM THE DIAL.
 *
 * WHY THIS IS HAND-ROLLED AND NOT THE BROWSER'S
 *   `apps/pwa/index.html` sets `user-scalable=no`, required verbatim by
 *   section 06. That is the right call for a driving app - a page that zooms
 *   under a thumb at 45 mph is a page that has lost the driver's place - but it
 *   also means the browser's own pinch is gone, so the dial has to implement
 *   the gesture itself. `touch-action: none` on the dial claims the pointers;
 *   nothing else on the screen takes a multi-touch gesture, so nothing is being
 *   stolen from.
 *
 * THE MODEL: THE RANGE IS A NUMBER, NOT A STEP
 *   The four range keys stay - they are the fast way to a known range - but the
 *   dial's outer ring is a continuous value underneath them. Pinching moves it
 *   smoothly and the key row highlights whichever named range is nearest, so
 *   the two controls describe one state rather than fighting over it.
 *
 * THE DIRECTION, AND WHY IT IS INVERTED
 *   Fingers apart means "show me less ground, bigger" - the outer ring gets
 *   SMALLER. So the scale factor divides. Getting this backwards is the classic
 *   pinch bug and it feels broken instantly, which is why it has a test.
 *
 * PURE ON PURPOSE
 *   No pointer events here, no element, no state. The gesture arithmetic is
 *   the part that is easy to get wrong and hard to test through a DOM, so it
 *   lives on its own and `SweepDial` only tracks pointers and calls in.
 */

import { MAX_OUTER_FT, MIN_OUTER_FT, clampOuterFt } from './zoom.ts';

export interface PinchAnchor {
  /** Distance between the two pointers when the gesture began, in px. */
  readonly startSpread: number;
  /** The dial's outer ring when the gesture began, in feet. */
  readonly startOuterFt: number;
}

/** Distance between two pointer positions. */
export function spread(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The dial's new outer ring for the current finger spread.
 *
 * Anchored to where the gesture STARTED rather than integrated frame by frame:
 * accumulating deltas drifts, so a driver who pinches out and back finds a
 * different range than they began with, which reads as the control being
 * broken.
 */
export function pinchOuterFt(anchor: PinchAnchor, currentSpread: number): number {
  if (
    !Number.isFinite(currentSpread) ||
    currentSpread <= 0 ||
    !Number.isFinite(anchor.startSpread) ||
    anchor.startSpread <= 0
  ) {
    return clampOuterFt(anchor.startOuterFt);
  }
  // Fingers apart (currentSpread > startSpread) -> smaller outer ring.
  return clampOuterFt(anchor.startOuterFt * (anchor.startSpread / currentSpread));
}

/**
 * Whether a pinch can still move in a direction, for the dial's data attribute.
 *
 * The range is clamped, and a control that keeps accepting a gesture it cannot
 * act on feels dead. This lets the dial say which way it can still go.
 */
export function pinchLimit(outerFt: number): 'min' | 'max' | null {
  const clamped = clampOuterFt(outerFt);
  if (clamped <= MIN_OUTER_FT) return 'min';
  if (clamped >= MAX_OUTER_FT) return 'max';
  return null;
}
