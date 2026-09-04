/**
 * THE ARCHIVE AS POINTS A STANDALONE DEVICE CAN ALERT ON.
 *
 * =============================================================================
 * WHY THIS IS GENERATED ON THE PHONE
 * =============================================================================
 * The obvious shape is a download link to a file somebody builds and hosts. It
 * is the wrong one here for three reasons, and the third is the real one:
 *
 *   IT WOULD NEED HOSTING. The two files together are about 20 MB, which is not
 *   bundling and is not free to serve at any interesting number of installs.
 *   THE APP ALREADY HAS THE DATA. `/cameras/overview.json` is fetched by the
 *   map and held by the service worker, so the bytes are on the device already.
 *   IT WOULD GO STALE SEPARATELY FROM THE APP. A hosted file has its own
 *   freshness, its own version, and its own way of disagreeing with what the
 *   driver is actually being warned about. Generated here it is exactly as
 *   current as the archive that just alerted them, by construction.
 *
 * It also works offline, which a download link does not.
 *
 * =============================================================================
 * WHAT THIS IS FOR
 * =============================================================================
 * A radar detector cannot do this. Standalone it alerts on RF plus a vendor
 * camera database that is not user-injectable, and its GPS "mute points" exist
 * to SILENCE a known false alert - the inverse of the job. What does work is a
 * satnav that takes custom POIs: it gives an audible proximity alert with no
 * phone, no account and no subscription.
 */

/** Every point carries the same name, and the reason is that it is spoken. */
export const POI_NAME = 'ALPR camera';

export interface ExportPoint {
  readonly lat: number;
  readonly lon: number;
}

export interface ExportSource {
  /** Flat `[lat, lon, lat, lon, ...]`, as `overview.json` stores it. */
  readonly coords: readonly number[];
  readonly attribution?: string;
  readonly licence?: string;
}

/** ODbL travels with the data, the way every published tile carries it. */
const FALLBACK_ATTRIBUTION = 'Map data © OpenStreetMap contributors';
const FALLBACK_LICENCE = 'ODbL-1.0';

/**
 * Flat pairs to points, dropping anything that is not a coordinate.
 *
 * A NaN or an out-of-range value would place a false alert somewhere real, so
 * they are dropped rather than clamped - a clamped coordinate is a confident
 * wrong answer, which is the thing this project refuses everywhere else.
 */
export function toPoints(coords: readonly number[]): readonly ExportPoint[] {
  const out: ExportPoint[] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const lat = coords[i];
    const lon = coords[i + 1];
    if (lat === undefined || lon === undefined) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ lat, lon });
  }
  return out;
}

/**
 * GARMIN CUSTOM POI CSV, AND THE COLUMN ORDER IS THE WHOLE RISK.
 *
 * Garmin's format is `lon,lat,name,description`. GPX attributes are `lat` then
 * `lon`. `overview.json` stores `[lat, lon, ...]`. Three orderings for the same
 * pair of numbers, and getting one wrong does not throw - it puts every camera
 * in the wrong hemisphere and produces a file that looks fine until somebody
 * drives with it.
 *
 * `docs/public/TAXONOMY.md` flags the same inversion for GeoJSON. It is the
 * single most likely way this feature ships broken.
 */
export function toGarminCsv(source: ExportSource): string {
  const attribution = source.attribution ?? FALLBACK_ATTRIBUTION;
  const rows = toPoints(source.coords).map(
    ({ lat, lon }) => `${lon.toFixed(6)},${lat.toFixed(6)},"${POI_NAME}","${attribution}"`,
  );
  return `${rows.join('\n')}\n`;
}

/** Standard GPX waypoints: `lat` first here, unlike the CSV above. */
export function toGpx(source: ExportSource): string {
  const attribution = source.attribution ?? FALLBACK_ATTRIBUTION;
  const licence = source.licence ?? FALLBACK_LICENCE;
  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="DarkRoute" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    '    <name>DarkRoute ALPR cameras</name>',
    `    <desc>${attribution} — ${licence}</desc>`,
    '  </metadata>',
  ];
  const body = toPoints(source.coords).map(
    ({ lat, lon }) =>
      `  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><name>${POI_NAME}</name></wpt>`,
  );
  return `${[...head, ...body, '</gpx>'].join('\n')}\n`;
}

export type PoiFormat = 'gpx' | 'csv';

export const POI_FORMATS: readonly PoiFormat[] = ['gpx', 'csv'];

export const POI_FORMAT_LABEL: Readonly<Record<PoiFormat, string>> = {
  gpx: 'GPX',
  csv: 'Garmin CSV',
};

export const POI_FORMAT_NOTE: Readonly<Record<PoiFormat, string>> = {
  gpx: 'waypoints. the format most satnavs and mapping apps take.',
  csv: 'the format Garmin’s POI Loader reads to build a proximity-alert file.',
};

export function poiFilename(format: PoiFormat, generatedAt: string | null): string {
  // The archive's own date in the name, so a driver can see at a glance whether
  // the file on their device is older than the one in their hand.
  const day = generatedAt === null ? 'unknown' : generatedAt.slice(0, 10);
  return `darkroute-alpr-${day}.${format}`;
}

export function renderPoi(format: PoiFormat, source: ExportSource): string {
  return format === 'csv' ? toGarminCsv(source) : toGpx(source);
}
