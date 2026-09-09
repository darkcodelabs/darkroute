/**
 * THE STREET IS THE GROUP, AND THE CAMERAS ON IT ARE THE ROWS.
 *
 * =============================================================================
 * WHAT THIS REPLACES
 * =============================================================================
 * LOOK UP drew a flat list led by the OPERATOR, because a list led by the
 * street put "ACCESS RD" on three rows in a row and said nothing. That fixed
 * the row and left the list: forty results down one column, in which the six
 * cameras on the corridor a driver is actually asking about are scattered among
 * thirty-four they are not.
 *
 * Grouping answers the question the screen is for. "Where are the cameras near
 * here" is asked one road at a time, and the answer a driver wants is
 * "METCALF AVE - six of them", not six separate rows that happen to share a
 * subtitle. `titleOf`/`subtitleOf` in `search.ts` stay exactly as they are:
 * DRIVE's search bar and the INTEL card still render the flat, operator-led
 * row, and this is a second shape for the same records rather than a
 * replacement for the first.
 *
 * =============================================================================
 * THE KEY IS THE STREET AND NOTHING ELSE, AND HERE IS THE COUNT BEHIND THAT
 * =============================================================================
 * Measured 2026-09-06 by decoding every shipped tile under
 * `apps/pwa/public/cameras/11` - 8,803 files, 139,918 records, not a sample:
 *
 *   street present        102,601   73.33%
 *   cross present          84,869   60.66%
 *   cross with NO street        0    0.00%
 *   neither                37,317   26.67%
 *   operator tag           23,766   16.99%
 *
 * The `operator` rate is re-measured here rather than quoted from
 * `db/schema.ts`, which says 17.69% against a smaller archive on 2026-08-31 and
 * asks in its own words to be re-measured rather than trusted. The archive R2
 * serves moves hourly, so re-measure these too rather than believing this
 * comment a year from now - but note that no plausible drift changes the
 * decisions below, all of which turn on a zero and a quarter.
 *
 * THE CROSS STREET IS NOT PART OF THE KEY. Two reasons, and the second is the
 * one that settles it. It cannot rescue a single record - there is not one
 * camera in the archive that has a cross street and no street - so folding it
 * in buys nothing at the bottom end. And at the top end it is actively
 * destructive: keying on "street at cross" shatters METCALF AVE into a card per
 * intersection, one row in each, which is the flat list again wearing more
 * chrome. The cross street is what tells two cameras on one road apart, so it
 * belongs on the ROW, which is where `rowTitleOf` puts it.
 *
 * TWO TOWNS' MAIN ST MERGE, AND THAT IS ACCEPTED. The name is not unique
 * nationally - MAIN ST appears 333 times in the archive - so two results a
 * county apart can land in one card. `countyFips` would split them and was
 * rejected: it is absent on 1.98% of records, and the split produces two cards
 * both titled MAIN ST with nothing on either saying which is which, which is
 * worse than one card whose rows each carry their own distance. The list is
 * capped at 40 nearest hits, so the case needs two Main Streets inside the
 * same handful of miles before it can appear at all.
 *
 * =============================================================================
 * THE 26.67% WITH NO STREET DO NOT VANISH AND DO NOT GET A FAKE ONE
 * =============================================================================
 * Better than a quarter of the archive has no street at all - the deleted TIGER
 * pipeline found no road within 40 m and refused to guess, which is the right
 * call and leaves this screen holding the consequence. Three ways to handle
 * them were considered:
 *
 *   INVENT A STREET, "UNKNOWN ST" or the first street in the list. Refused:
 *   the archive's own comment says a confident wrong street is worse than no
 *   street, and a card header is exactly where a wrong one would be believed.
 *
 *   A CARD EACH, keyed by id. Refused: eleven cards each badged "1" is the flat
 *   list with eleven headers added, and it makes the badge meaningless.
 *
 *   ONE TRAILING GROUP THAT DOES NOT CLAIM TO BE A STREET. Shipped. It is
 *   labelled `street not recorded` in the same voice as `owner unrecorded`
 *   elsewhere on this screen, it carries `isStreet: false` so the screen can
 *   draw it as a note rather than as a name, and its rows are ordinary rows
 *   with their owner, their distance and their tap into INTEL.
 *
 * It is always LAST, whatever it holds, and that is a deliberate trade. A
 * streetless camera 200 ft away will sit below a street group half a mile off.
 * The alternative - letting it sort by distance like the others - makes the one
 * group that answers no question the one that moves around the screen as the
 * fix drifts, and this list is read at a stop light. The count at the top of
 * the screen still counts it, and DRIVE is where "what is closest" is asked.
 *
 * =============================================================================
 * ONE RANKING, NOT TWO
 * =============================================================================
 * Nothing here sorts. `searchCameras` has already put the hits in the only
 * order this product has an argument for - nearest first when there is a fix,
 * by id when there is not, so the list cannot reshuffle between renders - and
 * this walks that array once and keeps it. So the rows inside a group are in
 * search order, and the groups themselves are in the order their nearest camera
 * appeared, which is the same rule applied one level up. A second sort here
 * could disagree with the first, and the two disagreeing is a list whose top
 * row is not its nearest camera.
 */

import type { CameraRecord } from '../../services/db/schema.ts';
import { shortOperator } from '../intel/intelState.ts';

import type { SearchHit } from './search.ts';

/**
 * What the trailing group is called.
 *
 * Not a street name and deliberately not shaped like one: lower case, a
 * statement about the archive rather than a place. `owner unrecorded` already
 * says an absence this way two lines further down the same row.
 */
export const NO_STREET_LABEL = 'street not recorded';

/**
 * The key the trailing group carries.
 *
 * A reserved string rather than the empty one, because a group key is used as a
 * React key and an empty string is indistinguishable from a bug that produced
 * no key at all. No street can collide with it: `streetKeyOf` upper-cases, and
 * this is lower case with a colon in it.
 */
export const NO_STREET_KEY = 'street:none';

export interface StreetGroup {
  /** Stable identity, and the React key. `NO_STREET_KEY` for the tail group. */
  readonly key: string;
  /** The card header. A street as the archive recorded it, or the note. */
  readonly label: string;
  /** False only for the tail group, which is a note and not a place. */
  readonly isStreet: boolean;
  /** The cameras under this header, in the order `searchCameras` ranked them. */
  readonly hits: readonly SearchHit[];
}

/**
 * The grouping key, or null when this record has no street to be grouped by.
 *
 * Upper-cased and whitespace-collapsed for the KEY only. The archive already
 * ships street names upper-cased, so in practice this normalisation changes
 * nothing today; it exists so that a future record spelled `Main St`, or one
 * carrying a double space, does not open a second card for a road that already
 * has one. The card still shows the spelling that was recorded - see `label`.
 */
export function streetKeyOf(camera: CameraRecord): string | null {
  const street = camera.street?.trim();
  if (street === undefined || street === '') return null;
  return street.toUpperCase().replace(/\s+/g, ' ');
}

/**
 * The hits, sorted into cards, in one pass.
 *
 * A `Map` rather than an object: it iterates in insertion order, which is
 * exactly the group ordering this wants, so the order falls out of the walk
 * instead of being computed a second way afterwards.
 */
export function groupByStreet(hits: readonly SearchHit[]): readonly StreetGroup[] {
  interface Draft {
    key: string;
    label: string;
    isStreet: boolean;
    hits: SearchHit[];
  }

  const byStreet = new Map<string, Draft>();
  const streetless: SearchHit[] = [];

  for (const hit of hits) {
    const key = streetKeyOf(hit.camera);
    if (key === null) {
      streetless.push(hit);
      continue;
    }
    const open = byStreet.get(key);
    if (open === undefined) {
      // The label is the FIRST spelling seen, which - because the walk is in
      // search order - is the spelling on the nearest camera of that street.
      byStreet.set(key, {
        key,
        label: hit.camera.street?.trim() ?? key,
        isStreet: true,
        hits: [hit],
      });
    } else {
      open.hits.push(hit);
    }
  }

  const groups: Draft[] = [...byStreet.values()];
  if (streetless.length > 0) {
    groups.push({
      key: NO_STREET_KEY,
      label: NO_STREET_LABEL,
      isStreet: false,
      hits: streetless,
    });
  }
  return groups;
}

/**
 * The accessible name for the list of rows inside a card.
 *
 * The badge is a bare numeral, which a screen reader announces as "2" sitting
 * between a street name and a list - true, and no use at all. This says the
 * same fact in words on the list the badge is counting, so the count reaches a
 * driver who is listening to the screen rather than looking at it.
 *
 * The plural is spelled out rather than suffixed, because "1 cameras" is the
 * kind of sloppiness that makes somebody doubt the number next to it.
 */
export function groupListLabel(group: StreetGroup): string {
  const count = group.hits.length;
  return `${group.label}, ${String(count)} ${count === 1 ? 'camera' : 'cameras'}`;
}

/** The `operator` tag, shortened the way the INTEL card shortens it. */
function operatorOf(camera: CameraRecord): string | null {
  const operator = camera.tags?.['operator'];
  return shortOperator(typeof operator === 'string' ? operator : null);
}

/** "at 12TH ST", or null when the archive recorded no cross street. */
function crossOf(camera: CameraRecord): string | null {
  const cross = camera.cross?.trim();
  if (cross === undefined || cross === '') return null;
  return `at ${cross}`;
}

/**
 * WHAT A ROW IS CALLED WHEN IT IS NOT ALLOWED TO BE CALLED BY ITS ID.
 *
 * Said as plainly as brief 4 says it: "`osm:12425289022` is a database key, not
 * a name. Lead with the cross street, or `unnamed pole` where there is none;
 * the id goes secondary in JetBrains Mono 11.5px faint."
 *
 * =============================================================================
 * THE LADDER, AND THE TWO CHANGES BRIEF 4 MAKES TO IT
 * =============================================================================
 * The question is still "what tells this camera apart from the others on this
 * road" - the street is on the card above and repeating it would read METCALF
 * AVE / METCALF AVE / METCALF AVE. What changed is which answers are allowed:
 *
 *   THE CROSS STREET FIRST, as "at 12TH ST". It was second. The brief promotes
 *   it and the spec's own frame agrees - every row it draws is a cross street
 *   or the fallback, and none is an operator. It is also the field a person
 *   uses out loud to pick one camera on a corridor out of nine, and 60.66% of
 *   records carry one. It can never fire in the streetless group: there is no
 *   record in the archive with a cross and no street.
 *
 *   THE OPERATOR SECOND, short form, when the mapper recorded one (16.99% of
 *   records). It was first. It is kept UNDER the cross street rather than
 *   deleted, because on a row with no cross street "JCPRD" is a real name and
 *   the alternative below it is not a name at all. The brief says lead with the
 *   cross street; it does not say throw away the only other name the archive
 *   has, and "every screen keeps its purpose, its data and its copy intent" is
 *   the brief's own first rule.
 *
 *   THE ID IS GONE FROM THIS LADDER. It is still on the row - it moved to the
 *   line underneath, in mono - so nothing a driver quotes when reporting a bad
 *   record has been lost. It simply stopped being the row's NAME.
 *
 * =============================================================================
 * `unnamed pole`, AND THE HALF OF THE SPEC'S STRING THAT IS NOT SHIPPED
 * =============================================================================
 * The spec writes `unnamed pole, north side`. THERE IS NO SIDE-OF-ROAD FIELD.
 * `services/db/schema.ts` carries `directionDeg` - which way the camera FACES,
 * not which side of the street its pole stands on - `tags['camera:mount']` at
 * 30.56% and `tags['surveillance:zone']` at 87.41%, and not one of them answers
 * "north side". The spec's own fixture uses the phrase twice on consecutive
 * ids purely to tell two rows apart in a static render.
 *
 * Deriving a compass word from `directionDeg` would be a fabrication of exactly
 * the kind this file's own header refuses: "a confident wrong street is worse
 * than no street", and a confident wrong SIDE is the same defect one field
 * over. So the side is not printed and the rest of the string is. This is
 * flagged in the handover as a question for the owner rather than settled here.
 */
export const UNNAMED_POLE = 'unnamed pole';

export function rowTitleOf(camera: CameraRecord): string {
  const cross = crossOf(camera);
  if (cross !== null) return cross;
  /* MID-BLOCK, OR OFF THE ROAD. The group header already names the street; a
     row with no cross street says which of those it is rather than falling to
     the operator or to `unnamed pole`. Sixty metres is a wide street plus a
     verge: further than that and the camera is not on the road at all. */
  const street = camera.street?.trim();
  if (street !== undefined && street !== '') {
    return camera.streetM !== undefined && camera.streetM > OFF_ROAD_M ? `off ${street}` : `on ${street}`;
  }
  return operatorOf(camera) ?? UNNAMED_POLE;
}

/** Past this many metres from its street a camera is beside the road, not on it. */
export const OFF_ROAD_M = 60;

/*
 * THE ROW'S SECOND LINE: EVERYTHING ELSE THE RECORD KNOWS.
 *
 * "Look how absolutely unhelpful this is" -- owner, 2026-09-09, of a list of
 * forty rows reading `unnamed pole` over a raw id. The id told a driver
 * nothing; the record under it carried the maker on 95% of cameras, the
 * direction on 99%, the mount on 30% and, from the release context, the town on
 * every one. This prints those, in the order a driver would ask them, and the
 * id only when there is nothing else at all.
 */
const MAKERS: ReadonlyMap<string, string> = new Map([
  ['Flock Safety', 'Flock'],
  ['Motorola Solutions', 'Motorola'],
  ['Vigilant Solutions', 'Vigilant'],
  ['Genetec Inc.', 'Genetec'],
  ['Axon Enterprise', 'Axon'],
]);
const MOUNTS: ReadonlyMap<string, string> = new Map([
  ['traffic_signal', 'signal'],
  ['street_lamp', 'lamp post'],
]);
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** "SW" for 225; null when the record has no direction. */
export function compassOf(deg: number | null | undefined): string | null {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return null;
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % POINTS.length;
  return POINTS[index] ?? null;
}

export function contextLineOf(camera: CameraRecord): string {
  const tags = camera.tags ?? {};
  const maker = tags['manufacturer'];
  const mount = tags['camera:mount'];
  const zone = tags['surveillance:zone'];
  const parts: string[] = [];
  if (typeof maker === 'string' && maker !== '') parts.push(MAKERS.get(maker) ?? maker);
  if (typeof mount === 'string' && mount !== '') parts.push(MOUNTS.get(mount) ?? mount.replaceAll('_', ' '));
  else if (typeof zone === 'string' && zone !== '' && zone !== 'traffic') parts.push(zone.replaceAll('_', ' '));
  const facing = compassOf(camera.directionDeg);
  if (facing !== null) parts.push(`faces ${facing}`);
  if (camera.locality !== undefined && camera.locality !== '') parts.push(camera.locality);
  return parts.length === 0 ? camera.id : parts.join(' \u00b7 ');
}
