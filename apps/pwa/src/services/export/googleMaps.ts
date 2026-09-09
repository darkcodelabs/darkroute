/**
 * "ADD THIS TO MY GOOGLE MAPS" - an export, not an integration.
 *
 * WHAT IS ACTUALLY POSSIBLE, AND WHAT IS NOT
 *   Google My Maps imports KML. A driver can take a file from here, import it
 *   at mymaps.google.com, and then see that map inside the Google Maps app
 *   under Your places → Maps, and navigate to a pin on it.
 *
 *   It does NOT overlay turn-by-turn navigation. There is no public API to put
 *   a layer into the navigation view, and My Maps is a separate map you switch
 *   to rather than a layer drawn over the blue line. So this feature is worth
 *   having and is worth being honest about: it gets the cameras into an app
 *   the driver already uses, and it will not put them on the screen while that
 *   app is guiding them.
 *
 * THE LIMIT IS A TRAP, SO WE DO NOT WALK INTO IT
 *   My Maps caps a layer at 2,000 features - and an import over that is
 *   SILENTLY TRUNCATED. No error, no warning; the map just quietly stops
 *   partway. For a product whose whole argument is that an empty map is not
 *   the same as a clear road, handing somebody a silently-cut export would be
 *   the worst thing this file could do.
 *
 *   So the cap is enforced here, the export reports exactly how many it left
 *   out, and the caller is expected to say so out loud.
 *
 * NOTHING IS SENT
 *   The KML is built on the device from tiles already cached there. No request
 *   is made, nothing is uploaded, and Google learns nothing until the driver
 *   chooses to import the file themselves.
 */

import type { CameraRecord } from '../db/schema.ts';

/** My Maps' own per-layer ceiling. Over this, an import is cut without saying so. */
export const MY_MAPS_FEATURE_CAP = 2_000;

/** ODbL. The data is OpenStreetMap's and the credit travels with the file. */
export const KML_ATTRIBUTION = 'Map data © OpenStreetMap contributors (ODbL 1.0)';

export interface KmlExport {
  readonly kml: string;
  readonly included: number;
  /** How many were left out by the cap. The caller must surface this. */
  readonly omitted: number;
  readonly filename: string;
}

export interface KmlOptions {
  /** Shown as the layer name in My Maps. */
  readonly name: string;
  /** Defaults to {@link MY_MAPS_FEATURE_CAP}. */
  readonly cap?: number;
  /** Sort key so the cap keeps the most useful ones. Defaults to as-given. */
  readonly compare?: (a: CameraRecord, b: CameraRecord) => number;
}

/** XML text escaping. A camera id is ours, but never trust a string with `&`. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function describe(camera: CameraRecord): string {
  const facing =
    camera.directionDeg === null || camera.directionDeg === undefined
      ? 'facing unknown'
      : `faces ${String(Math.round(camera.directionDeg))}°`;
  const owner = camera.ownerType === undefined ? 'operator unrecorded' : `owner: ${camera.ownerType}`;
  return `${facing} · ${owner} · ${camera.id}`;
}

export function buildKml(
  cameras: readonly CameraRecord[],
  options: KmlOptions,
): KmlExport {
  const cap = options.cap ?? MY_MAPS_FEATURE_CAP;
  const ordered = options.compare === undefined ? [...cameras] : [...cameras].sort(options.compare);
  const included = ordered.slice(0, Math.max(0, cap));
  const omitted = ordered.length - included.length;

  const placemarks = included
    .map(
      (camera) =>
        `  <Placemark>\n` +
        `    <name>${escapeXml(camera.id)}</name>\n` +
        `    <description>${escapeXml(describe(camera))}</description>\n` +
        // KML is lon,lat - the reverse of every other coordinate in this
        // codebase. Getting it backwards puts every camera in the wrong
        // hemisphere, which is why it is written once, here.
        `    <Point><coordinates>${String(camera.lon)},${String(camera.lat)}</coordinates></Point>\n` +
        `  </Placemark>`,
    )
    .join('\n');

  const kml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
    `<Document>\n` +
    `  <name>${escapeXml(options.name)}</name>\n` +
    `  <description>${escapeXml(
      `${String(included.length)} ALPR cameras. ${KML_ATTRIBUTION}.` +
        (omitted > 0
          ? ` ${String(omitted)} more were left out: Google My Maps accepts 2,000 per layer and truncates silently past that.`
          : ''),
    )}</description>\n` +
    `${placemarks}\n` +
    `</Document>\n` +
    `</kml>\n`;

  return {
    kml,
    included: included.length,
    omitted,
    filename: `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-alpr.kml`,
  };
}

/**
 * The sentence shown beside the button, before the driver commits.
 *
 * It says the limitation first. A driver who imports this expecting it to
 * appear over their navigation and finds it does not will trust the rest of
 * the product less, and they would be right to.
 */
export function exportNotice(result: KmlExport): string {
  const base =
    `${String(result.included)} cameras as a google my maps layer. ` +
    'it shows in the google maps app under your places - it does not draw over turn-by-turn navigation.';
  return result.omitted === 0
    ? base
    : `${base} ${String(result.omitted)} were left out: my maps takes 2,000 per layer and cuts the rest without telling you.`;
}
