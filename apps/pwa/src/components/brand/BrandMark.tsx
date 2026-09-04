/**
 * THE MARK - the darkroute eye, beside every screen's title.
 *
 * =============================================================================
 * WHY IT IS A MASK AND NOT AN IMAGE
 * =============================================================================
 * It has to be the same colour as the title it sits next to, and that colour is
 * not one colour: RADAR's title takes the alert state hue, so it is green while
 * the road is clear and crimson while something is inside the threshold. Every
 * other screen has its own.
 *
 * An `<img>` cannot follow that -- a PNG is the colours it was saved with, and
 * shipping one file per hue would be six assets that drift apart the first time
 * a theme changes. The artwork is used as a MASK over `currentColor` instead,
 * so the mark inherits whatever the title is painted with, including the eight
 * theme modes, from one asset and with no per-screen wiring.
 *
 * `components/dock/ReportKey.tsx` already does exactly this for its crimson
 * eye. This is the same technique, promoted to a shared component so a screen
 * cannot get it slightly wrong.
 *
 * =============================================================================
 * WHY IT IS BIGGER THAN THE TEXT, AND HAS A GROUND
 * =============================================================================
 * A mark at the cap height of the type reads as a bullet point. Set slightly
 * taller than the title, it becomes the thing the eye lands on first, which is
 * what a mark is for.
 *
 * The disc behind it is not decoration. These screens are near-black and the
 * mark is a thin silhouette; without a ground it dissolves into the background
 * at a glance in daylight. A tint of its own colour lifts it off the page
 * without introducing a second one.
 */

import type { ReactElement } from 'react';

import './brand.css';

export interface BrandMarkProps {
  /**
   * A name for the reader, or nothing.
   *
   * Defaults to nothing on purpose: the mark sits beside a title that already
   * says which screen this is, and a second announcement would make every
   * header read its own name twice.
   */
  readonly label?: string | undefined;
}

export function BrandMark({ label }: BrandMarkProps): ReactElement {
  return (
    <span
      className="fwm-brand-mark"
      {...(label === undefined
        ? { 'aria-hidden': 'true' as const }
        : { role: 'img', 'aria-label': label })}
    />
  );
}
