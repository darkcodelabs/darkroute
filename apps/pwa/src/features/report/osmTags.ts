/**
 * A REPORT, EXPRESSED AS OPENSTREETMAP TAGS.
 *
 * =============================================================================
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT
 * =============================================================================
 * This turns a driver's report into the exact tag set OSM expects for an ALPR
 * camera, and produces a link that opens the OSM editor at the right place. It
 * does NOT upload anything. There is no OAuth here, no changeset API call, no
 * automatic submission.
 *
 * That restraint is the design, not an unfinished edge. Research into how the
 * OSM community treats app-driven editing found two outcomes worth avoiding:
 *
 *   MAPS.ME reached the point where 36% OF ALL ITS EDITS WERE DUPLICATE POIs,
 *   because the app stopped showing people what already existed nearby. The
 *   result was systematic manual reverts across multiple countries, DWG blocks,
 *   speed cameras filed as police stations, and a permanent reputational mark.
 *
 *   DEFLOCK -- in this exact domain, within the last year -- had its iD editor
 *   preset REMOVED because users pasted its placeholder text literally, filing
 *   real cameras as `operator=(AllentownPolice)`. The mechanism was a
 *   copy-pasteable instruction block, which is a feature anyone would ship
 *   without thinking twice.
 *
 * So: no copy-pasteable block containing placeholder syntax, ever. The values
 * below are final or they are absent.
 *
 * Uploading under a user's own OAuth account is the right eventual shape, and
 * it needs an Organised Editing Activity registered and announced at least two
 * weeks before the first write, plus a named human answering within two working
 * days. A direct competitor registered exactly that before writing anything and
 * was told, verbatim, "your platform will be judged mainly by the
 * worst-case-users". None of that is code, and none of it should be skipped by
 * writing the upload first.
 *
 * =============================================================================
 * THREE CORRECTIONS THE OBVIOUS TAGGING GETS WRONG
 * =============================================================================
 * Measured against the live corpus (144,788 objects carrying
 * `surveillance:type=ALPR`), not against intuition:
 *
 * 1. `manufacturer=Flock Safety`, NOT `operator`. The community explicitly
 *    split these: Flock builds the camera, the OPERATOR is the agency that owns
 *    the footage. 73.2% carry the manufacturer tag; only 19.0% carry an
 *    operator, because most people cannot know it.
 *
 * 2. `direction`, NOT `camera:direction`. The wiki documents the latter; the
 *    corpus does not use it -- `direction` appears on 93.6% of these nodes and
 *    `camera:direction` does not appear in the top co-occurring keys at all.
 *    Write what the data uses; read both forever.
 *
 * 3. `surveillance:type=ALPR`, not `surveillance:type=camera` plus a
 *    `camera:type`. `camera:type` carries the physical form (fixed, panning,
 *    dome), which is a different question.
 */

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';

import { REPORT_PAYLOAD_SCHEMA } from './reportDraft.ts';
import type { MountKind, ReportDraft, ReportSubject } from './reportDraft.ts';

/** The app's identity in a changeset. */
export const CREATED_BY = 'DarkRoute';
export const CHANGESET_HASHTAG = '#darkroute';

/**
 * `camera:mount` values, mapped from the chips the report screen offers.
 *
 * `unsure` maps to NOTHING. The screen offers it because a driver at speed
 * genuinely may not know, and inventing `pole` because it is the commonest
 * answer would put a guess into a public database under their account.
 *
 * `trailer` MAPS TO NOTHING EITHER, and that is a change from what this file
 * originally said. Measured against live taginfo rather than intuition:
 *
 *   camera:mount=pole         117,721
 *   camera:mount=wall         101,099
 *   camera:mount=ceiling       17,745
 *   camera:mount=street_lamp   17,341
 *   camera:mount=trailer           38
 *
 * Thirty-eight, worldwide, with an unconsolidated long tail beside it
 * (`speed trailer` 6, `Trailer` 5, `pole_and_trailer` 5). Scoped to
 * `surveillance:type=ALPR` it does not appear at all. Pointing a whole
 * userbase at a 38-use value is how an app invents a tag by force, which is
 * the specific failure the rest of this file exists to avoid -- and it would
 * be this app that did it, since nothing has written a single one yet.
 *
 * The observation is not discarded, only the claim. The app still records that
 * the driver saw a trailer; it just does not assert a global tagging
 * convention that does not exist. If `camera:mount=trailer` gets consolidated
 * and documented, this becomes one line.
 */
const MOUNT_TAG: Readonly<Record<MountKind, string | null>> = {
  pole: 'pole',
  solar: 'pole',
  trailer: null,
  unsure: null,
};

/** Flock's Wikidata item, carried by 72.4% of ALPR nodes alongside the name. */
export const FLOCK_WIKIDATA = 'Q108485435';

/**
 * WHERE A NODE WOULD GO, or null if this report cannot say.
 *
 * =============================================================================
 * THE GATE, AND WHY IT IS A FUNCTION RATHER THAN A CONVENTION
 * =============================================================================
 * Every upload path has to ask one question before it asks any other: what
 * coordinate does this node get. Getting that wrong is not a degraded edit, it
 * is a wrong edit at scale under a real person's account, so the answer lives
 * in one function that can return null and be tested, rather than in whichever
 * caller happens to reach for a lat and a lon.
 *
 * It reads `subject_position` and NOTHING ELSE. It will not fall back to
 * `observer_position`, and that refusal is the entire point:
 *
 *   - `fwm-report/v1` records carry only the driver's fix under the name
 *     `position`. Publishing those would file cameras in traffic lanes with a
 *     uniform offset - the exact pattern that gets a source mass-reverted -
 *     while publishing a fine-grained trail of where one person drove. Every
 *     v1 record is therefore ineligible, permanently, by construction.
 *   - A v2 record where nobody established the camera's position returns null
 *     for the same reason. "Not established" is an answer.
 *
 * A fallback here would be invisible in review and catastrophic in aggregate,
 * which is why there is no parameter to enable one.
 */
export function osmNodePosition(
  payload: CanonicalObject | null,
): { readonly lat: number; readonly lon: number } | null {
  if (payload === null) return null;
  const subject = payload['subject_position'];
  if (subject === null || typeof subject !== 'object' || Array.isArray(subject)) return null;
  const lat = (subject as Record<string, unknown>)['lat'];
  const lon = (subject as Record<string, unknown>)['lon'];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Why a report cannot be published, or null when it can. */
export type OsmBlocker = 'no-subject-position' | 'legacy-schema' | 'demo-origin';

/**
 * The one call an uploader makes before doing anything else.
 *
 * `demo-origin` is here because the demo drive writes fabricated fixes into the
 * real position store and is reachable from Settings in a production build. A
 * report filed during it looks, to every other check in the system, exactly
 * like a real one - it even carries a 4 m accuracy, which passes any accuracy
 * gate as HIGH confidence. The only thing that can distinguish it is a flag set
 * at capture time, so the payload has to carry one and this has to read it.
 */
export function osmBlocker(payload: CanonicalObject | null): OsmBlocker | null {
  if (payload === null) return 'no-subject-position';
  if (payload['schema'] !== REPORT_PAYLOAD_SCHEMA) return 'legacy-schema';
  if (payload['synthetic'] === true) return 'demo-origin';
  return osmNodePosition(payload) === null ? 'no-subject-position' : null;
}

/** Whether the driver's free text actually names Flock. */
function namesFlock(makeModel: string): boolean {
  return /\bflock\b/i.test(makeModel);
}

export type OsmTags = Readonly<Record<string, string>>;

/**
 * The tags for a NEW camera node.
 *
 * Only what the report actually establishes. Every field the driver left blank
 * is absent rather than defaulted -- a tag nobody observed is a claim nobody
 * made, and it arrives in OSM under their name.
 */
export function newCameraTags(draft: ReportDraft, subject: ReportSubject): OsmTags {
  const tags: Record<string, string> = {
    man_made: 'surveillance',
    'surveillance:type': 'ALPR',
    // The corpus's own majority: 75% public, 83% traffic. Both are true of any
    // roadside ALPR by definition -- it watches a public road.
    surveillance: 'public',
    'surveillance:zone': 'traffic',
    'camera:type': 'fixed',
  };

  if (draft.facingDeg !== null && Number.isFinite(draft.facingDeg)) {
    // Whole degrees. A compass on a phone in a moving car does not justify
    // decimals, and OSM readers parse an integer bearing.
    tags['direction'] = String(Math.round(((draft.facingDeg % 360) + 360) % 360));
  }

  const mount = draft.mount === null ? null : MOUNT_TAG[draft.mount];
  if (mount !== null && mount !== undefined) tags['camera:mount'] = mount;

  if (namesFlock(draft.makeModel)) {
    tags['manufacturer'] = 'Flock Safety';
    tags['manufacturer:wikidata'] = FLOCK_WIKIDATA;
  }

  // Deliberately absent: `operator`. See correction 1 in the header -- a driver
  // passing at 45 mph cannot know which agency holds the footage, and guessing
  // it from the manufacturer is exactly the error the community split these
  // tags to prevent.
  void subject;
  return Object.freeze(tags);
}

/**
 * Changeset tags.
 *
 * `created_by` and a human comment are what the API documentation asks every
 * client to send. The hashtag is what makes this activity auditable by the
 * community -- which is the point: an organised edit that cannot be found is
 * one nobody can review, and being reviewable is the whole basis for being
 * allowed to do this at all.
 */
export function changesetTags(version: string, comment: string): OsmTags {
  return Object.freeze({
    // SPACE, NOT SLASH. Sampled across 100 live changesets: 83 space-form, 17
    // slash-form, and the slash-form is almost entirely legacy `JOSM/1.5`.
    // Every current editor writes a space -- `iD 2.42.2`, `StreetComplete 63.4`,
    // `Every Door Android 7.1`, `DeFlock 2.11.0`. Matching them is not
    // cosmetic: this string is how a reviewer filters our edits, so writing the
    // minority form makes the app harder to audit, which is the opposite of
    // what the tag is for.
    created_by: `${CREATED_BY} ${version}`,
    comment: comment.trim() === '' ? 'Add ALPR camera' : comment.trim(),
    hashtags: CHANGESET_HASHTAG,
    // The driver stood next to it. That is a survey, and saying so tells a
    // reviewer the value came from the ground rather than from imagery.
    source: 'survey',
  });
}

/**
 * A link that opens the OSM editor over this spot.
 *
 * Position only. iD has no supported way to pre-fill arbitrary tags from a URL,
 * and the workaround -- handing the user a block of text to paste -- is exactly
 * what got DeFlock's preset pulled. The app shows the tags as final values on
 * screen; the editor opens where the camera is; the person does the edit.
 */
export function editorUrl(lat: number, lon: number, zoom = 19): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const z = Math.min(22, Math.max(1, Math.round(zoom)));
  return (
    'https://www.openstreetmap.org/edit?editor=id' +
    `#map=${String(z)}/${lat.toFixed(5)}/${lon.toFixed(5)}`
  );
}

/**
 * How far away an existing camera has to be before this counts as a NEW one.
 *
 * THE MAPS.ME LESSON, as a number. Its single biggest failure was ceasing to
 * show people what already existed nearby, and 36% of its edits became
 * duplicates. Anything within this radius must be offered as "is it this one?"
 * before a new node is proposed.
 */
export const DUPLICATE_RADIUS_M = 25;

/**
 * Existing cameras close enough that a new report is probably about one of them.
 *
 * THE MAPS.ME FAILURE, PREVENTED. That app reached 36% duplicate POIs for one
 * specific reason: it stopped showing people what already existed nearby, so
 * they added a second node for something already mapped. The fix is not
 * cleverness, it is showing the driver the candidates before letting them
 * create anything.
 *
 * Sorted nearest first, because the answer is nearly always the first one.
 */
export function nearbyExisting<T extends { readonly lat: number; readonly lon: number }>(
  lat: number,
  lon: number,
  records: readonly T[],
  radiusM: number = DUPLICATE_RADIUS_M,
): readonly { readonly record: T; readonly distanceM: number }[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const latRad = (lat * Math.PI) / 180;
  const scale = Math.cos(latRad);
  const out: { record: T; distanceM: number }[] = [];
  for (const record of records) {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;
    const dx = (record.lon - lon) * (Math.PI / 180) * scale;
    const dy = (record.lat - lat) * (Math.PI / 180);
    const distanceM = Math.hypot(dx, dy) * 6_378_137;
    if (distanceM <= radiusM) out.push({ record, distanceM: Math.round(distanceM * 10) / 10 });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}
