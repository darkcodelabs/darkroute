/**
 * SHARE CARD -- the payload `services/adapters/share.ts` already reserves a kind
 * for (`zone-audit-card`).
 *
 * =============================================================================
 * IT IS TEXT, NOT AN IMAGE
 * =============================================================================
 * B6 labels the preview `SHARE CARD - RENDERS AS AN IMAGE`. Nothing in this app
 * can turn a DOM subtree into a PNG, and re-drawing the card into a canvas would
 * mean two copies of the same design in two languages, one of which would drift.
 * The share carries the card's own words instead, which state the same numbers.
 * GAP: see docs/gaps-inbox/zone-audit.md#share-card-does-not-render-as-an-image
 *
 * =============================================================================
 * NO ORIGIN IS CONSTRUCTED HERE, EVER
 * =============================================================================
 *   "A share can carry a link, and the production host is configuration, not
 *    source ... A share with no configured origin goes out without a link
 *    rather than with the wrong one."
 *      -- services/adapters/share.ts
 * `origin` is passed in from the app's environment config or it is absent, and
 * absent means the payload has no `url` at all. This module contains no domain.
 * GAP: see docs/gaps-inbox/zone-audit.md#no-configured-origin-so-the-card-carries-no-domain
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * No plate: no plate value exists in any type this module imports. No location:
 * the inputs are counts, a radius the user chose and an optional name the user
 * supplied, and `ZoneStats` has never held a coordinate.
 */

import type { SharePayload } from '../../services/adapters/share.ts';

import { ZONE_STAT_ROWS, cardProvenance, cardSentence, zoneStatValue } from './zone.ts';
import type { ZoneRadiusMi, ZoneStats } from './zone.ts';

/**
 * The lockup B6 draws over the hero numeral, in its two halves.
 *
 * The old name split at a word boundary that the design supplied by hand
 * (`Flockys` + `WatchingMe`). `DarkRoute` carries its own: the capital R is the
 * seam, so the two-tone lockup needs no separator and reads as one word --
 * which is the property the design was after, and the reason the name is
 * camel-cased rather than `Darkroute`.
 */
export const BRAND_PREFIX = 'Dark';
export const BRAND_SUFFIX = 'Route';

/** The sheet's document title. The screen's own name. */
export const SHARE_CARD_TITLE = 'ZONE AUDIT';

export interface ShareCardInput {
  readonly stats: ZoneStats;
  readonly radiusMi: ZoneRadiusMi;
  /** What named the zone, when anything did. Never a coordinate. */
  readonly place?: string | null;
  readonly atMs: number;
  /** Absolute origin from app config. Never built here. Omit for no link. */
  readonly origin?: string | null;
}

/** The card, as words. Same numbers, same order, same labels as the preview. */
export function shareCardText(input: ShareCardInput): string {
  const rows = ZONE_STAT_ROWS.map((row) => `${row} ${String(zoneStatValue(input.stats, row))}`);
  return [
    `${String(input.stats.total)} ${cardSentence(input.radiusMi, input.place ?? null)}`,
    '',
    ...rows,
    '',
    cardProvenance(input.atMs),
  ].join('\n');
}

/**
 * The payload the adapter is handed.
 *
 * `url` is present only when an origin was supplied. `files` is deliberately
 * absent: see the header.
 */
export function buildZoneSharePayload(input: ShareCardInput): SharePayload {
  const base = {
    kind: 'zone-audit-card',
    title: SHARE_CARD_TITLE,
    text: shareCardText(input),
  } as const;
  const origin = input.origin ?? null;
  return origin === null || origin.trim() === '' ? base : { ...base, url: origin.trim() };
}
