/**
 * WHAT TO CALL A CAMERA WHEN NOBODY HAS SAID WHO OWNS IT.
 *
 * =============================================================================
 * "UNVERIFIED" IS NOT A DESCRIPTION
 * =============================================================================
 * `ownerType` is `unverified` on most records - it means one person reported it
 * and nobody has confirmed the agency - and the chip on DRIVE printed that word
 * and nothing else. It is true and it is useless: it tells a driver the app is
 * unsure, when the record usually knows perfectly well WHAT the thing is.
 *
 * OSM carries `manufacturer` on 91.66% of these nodes and `brand` on a further
 * 4%, measured across the whole archive. "FLOCK SAFETY" is a better answer to
 * "what is that" than "UNVERIFIED", and it is the same fact the intel card has
 * been printing as its title all along.
 *
 * The owner still wins when it is known. An agency that has been confirmed is a
 * stronger claim than a brand name, and it is the one that decides the hue.
 */

import type { CameraOwnerType, CameraRecord } from '../../services/db/schema.ts';

import { OWNER_LABEL, tagValue } from './intelState.ts';

/**
 * An OSM tag value, as a person would read it.
 *
 * The raw values are lower_snake_case machine strings - `traffic_signals`,
 * `street_lamp` - and the intel tiles were shouting them verbatim:
 * "TRAFFIC_SIGNALS". The underscore is the giveaway that nobody wrote it for a
 * reader.
 */
export function readableTag(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.trim().replace(/[_-]+/g, ' ');
  if (cleaned === '') return null;
  return cleaned;
}

/**
 * The maker, from the two tags that carry it.
 *
 * `model` is deliberately not used: it is the part number, not the thing on the
 * pole, and "FALCON LR" answers a question nobody asked from a moving car.
 */
export function makerOf(record: CameraRecord | null): string | null {
  return readableTag(tagValue(record, 'manufacturer') ?? tagValue(record, 'brand'));
}

/**
 * Where it is mounted, from the two tags that carry it.
 *
 * `camera:mount` on 30.55% of nodes, `support` on some of the rest.
 */
export function mountOf(record: CameraRecord | null): string | null {
  return readableTag(tagValue(record, 'camera:mount') ?? tagValue(record, 'support'));
}

/**
 * The mount as a fragment of a sentence: "on a pole", "on traffic signals".
 *
 * Two things go wrong if the raw value is dropped into prose. It arrives
 * SHOUTING, because `tagValue` upper-cases every tag for the intel tiles, and
 * the DRIVE line is lowercase prose. And "a" is wrong in front of the one
 * common plural OSM uses: `traffic_signals`. Ending in "s" is a crude test for
 * plural in general and an exact one for the values this tag actually takes -
 * pole, wall, mast, gantry, building, tree, bridge, street_lamp, post.
 */
export function mountPhrase(record: CameraRecord | null): string | null {
  const mount = mountOf(record)?.toLowerCase() ?? null;
  if (mount === null) return null;
  return mount.endsWith('s') ? `on ${mount}` : `on a ${mount}`;
}

/**
 * What the chip on DRIVE says.
 *
 * The owner when it is a real attribution, the maker when it is not, and
 * nothing at all when the record knows neither - an empty chip is better than
 * one that says the app is unsure, which the border hue already says.
 */
export function chipLabel(
  ownerType: CameraOwnerType | undefined,
  record: CameraRecord | null,
): string | null {
  if (ownerType !== undefined && ownerType !== 'unverified') return OWNER_LABEL[ownerType];
  const maker = makerOf(record);
  if (maker !== null) return maker.toUpperCase();
  return ownerType === undefined ? null : OWNER_LABEL[ownerType];
}
