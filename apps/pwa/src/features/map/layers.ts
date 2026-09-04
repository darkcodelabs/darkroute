/**
 * THE MAP'S OWN LAYERS - what MapLibre draws, and what it replaces.
 *
 * =============================================================================
 * WHAT THIS DELETES
 * =============================================================================
 * Every layer here is something the hand-built scope did the hard way, and the
 * list is the whole argument for the migration:
 *
 *   HEAT      `sweep/heat.ts` accumulated density into an alpha channel with
 *             `lighter` compositing and then walked EVERY PIXEL in JavaScript
 *             to apply a colour ramp. MapLibre has a `heatmap` layer type: the
 *             same picture, computed in a fragment shader, at any zoom.
 *
 *   CLUSTERS  The former scope merged markers by screen proximity and had to
 *             invent a rule for what tapping a merged marker meant. A GeoJSON
 *             source clusters natively, and a cluster is a real feature with a
 *             real count that can be tapped and expanded.
 *
 *   CULLING   `frameHalfSpan` worked out what the viewport showed so markers
 *             could be culled to it. MapLibre culls by definition.
 *
 *   PLACEMENT `sweep/geometry.ts` projected everything polar from the vehicle.
 *             This is Web Mercator, like every other map, so a straight road is
 *             straight and panning is panning.
 *
 * =============================================================================
 * WHY COLOUR IS BY OWNER AND NOT BY DISTANCE
 * =============================================================================
 * The dial coloured markers by distance from the vehicle, which meant every
 * marker's colour changed on every GPS fix -- fine when we were re-rendering
 * the whole scope anyway, and wasteful here, because it would mean rewriting
 * the entire feature collection once a second to restyle it.
 *
 * It was also the less useful reading. Distance is already given by the map:
 * near things are near the middle. What the map could NOT say, and now can, is
 * WHO IS WATCHING -- the OSM records carry `operator`, `manufacturer` and
 * `camera:type`, and that is the fact a driver cannot work out by looking.
 *
 * Proximity has not been thrown away: it drives the alert state on RADAR, and
 * the in-range ring below is drawn from the engine's own assessment.
 */

import type { Palette } from './palette.ts';

/** The GeoJSON source every camera layer reads. */
export const CAMERA_SOURCE = 'fwm-cameras';
export const CAMERA_LAYER = 'fwm-camera-points';
export const CLUSTER_LAYER = 'fwm-camera-clusters';
export const CLUSTER_COUNT_LAYER = 'fwm-camera-cluster-count';
export const HEAT_LAYER = 'fwm-camera-heat';
export const HIT_LAYER = 'fwm-camera-hit';

/**
 * How big a camera's TOUCH target is, regardless of how big it looks.
 *
 * The drawn marker is a 5px-radius dot at street zoom -- about a 13px target.
 * Measured: a tap 8px off centre lands, one 14px off misses entirely, which in
 * a moving car means the driver simply cannot open a camera. Reported as "I
 * can't click these".
 *
 * 22 gives a 44px target, which is the smallest a thumb is reliably expected to
 * hit. The layer is fully transparent: it changes what can be TOUCHED without
 * changing what is SEEN, because making the dots themselves 44px across would
 * turn a metro into overlapping blobs.
 */
export const HIT_RADIUS = 22;

/**
 * Above this zoom, individual cameras; below it, the field.
 *
 * The two answer different questions and drawing both everywhere makes a mess
 * of each. Zoomed out, "where is it bad" is the only readable question and the
 * heatmap answers it. Zoomed in, the driver wants THIS camera, and a heat blob
 * over a single pole says nothing a marker does not.
 */
export const HEAT_MAX_ZOOM = 13;
export const POINT_MIN_ZOOM = 11;

/**
 * How far out CLUSTERS still draw. Much further than individual points.
 *
 * Both used POINT_MIN_ZOOM, so every camera layer switched off below z11 and
 * zooming out to look at a state -- or the country -- produced an empty map.
 * Reported as "why are all the camera data points not showing".
 *
 * A single point at national zoom is meaningless and there would be 131,000 of
 * them, so points keep their floor. A CLUSTER is exactly what that zoom wants:
 * one mark saying how many are down there. Supercluster is doing the work
 * either way -- the features exist at every zoom, they were simply not drawn.
 */
export const CLUSTER_MIN_ZOOM = 3;

/**
 * The heatmap layer.
 *
 * The ramp is plasma REVERSED -- sparse ground at the cold end, a lined
 * corridor incandescent -- which is the same palette the markers use, for the
 * same reason as before: a map with two colour languages on it makes a reader
 * learn both before either means anything.
 *
 * `heatmap-radius` grows with zoom so a blob stays a piece of GROUND rather
 * than a piece of the screen. That was a bug worth remembering: with a fixed
 * screen radius, zooming out merged a whole metro into one lump sitting on the
 * vehicle, and the picture stopped depending on where the cameras were.
 */
export function heatLayer(palette: Palette, maxZoom: number = HEAT_MAX_ZOOM + 1): unknown {
  return {
    id: HEAT_LAYER,
    type: 'heatmap',
    source: CAMERA_SOURCE,
    /**
     * WHERE THE FIELD HANDS OVER TO THE MARKS, and why it is a parameter.
     *
     * The heat layer used to be added ONLY in clustered mode, to stop a glow
     * being drawn over every one of nine hundred individual markers -- a real
     * complaint, and a real fix for it. But it removed the field at EVERY zoom
     * rather than at the zooms where markers exist, and with clustering off the
     * point layer is itself hidden below `POINT_MIN_ZOOM`. So zooming out with
     * clusters off produced a map with nothing on it whatsoever: no marks, no
     * clusters (a non-clustered source emits no `point_count` for the cluster
     * layers to match), and no field.
     *
     * The field's job is the FAR view in both modes. What changes is where it
     * stops: clustered, it can run up to `HEAT_MAX_ZOOM` alongside marks that
     * are sparse by construction; unclustered, it must stop exactly where the
     * individual poles start, so the two never overlap.
     */
    maxzoom: maxZoom,
    paint: {
      // One camera contributes a little; density is what makes it loud.
      'heatmap-weight': 0.6,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 13, 2.4],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'transparent',
        0.15,
        palette['--fwm-plasma-10'],
        0.35,
        palette['--fwm-plasma-8'],
        0.55,
        palette['--fwm-plasma-6'],
        0.75,
        palette['--fwm-plasma-4'],
        0.9,
        palette['--fwm-plasma-2'],
        1,
        palette['--fwm-plasma-0'],
      ],
      // Ground, not screen: doubling per zoom step keeps the blob over the same
      // patch of road as the scale changes.
      'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 4, 4, 13, 60],
      // Hand over to the markers rather than stacking both.
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 13, 0],
    },
  };
}

/**
 * One camera.
 *
 * Coloured by who runs it, which is a fact the driver cannot see from the car
 * and which the records finally carry. `unverified` is the honest majority --
 * OSM's ALPR nodes usually have no `operator` at all -- and it is drawn as the
 * quietest of the four rather than being guessed into one of the others.
 */
export function cameraLayer(palette: Palette): unknown {
  return {
    id: CAMERA_LAYER,
    type: 'circle',
    source: CAMERA_SOURCE,
    minzoom: POINT_MIN_ZOOM,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 18, 11],
      'circle-color': [
        'match',
        ['get', 'ownerType'],
        'police',
        palette['--fwm-alert-in-range'],
        'inter_agency',
        palette['--fwm-alert-multiple'],
        'hoa',
        palette['--fwm-alert-approaching'],
        'private',
        palette['--fwm-plasma-6'],
        palette['--fwm-accent-scan'],
      ],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1],
      'circle-stroke-color': palette['--fwm-bg'],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.75, 14, 1],
    },
  };
}

/** A cluster: one circle that grows with what it holds. */
export function clusterLayer(palette: Palette): unknown {
  return {
    id: CLUSTER_LAYER,
    type: 'circle',
    source: CAMERA_SOURCE,
    minzoom: CLUSTER_MIN_ZOOM,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 10, 10, 14, 50, 19, 200, 26],
      'circle-color': palette['--fwm-alert-in-range'],
      'circle-opacity': 0.28,
      'circle-stroke-width': 1,
      'circle-stroke-color': palette['--fwm-alert-in-range'],
    },
  };
}

/**
 * The count inside a cluster.
 *
 * A count is honest HERE in a way it was not on the dial. A cluster is a real
 * feature with a real member list, tapping it zooms to its bounds, and the
 * number is the thing being zoomed into -- rather than a digit beside a marker
 * that then opened one arbitrary member's record.
 */
/**
 * An invisible, thumb-sized target over every camera and cluster.
 *
 * Drawn UNDER nothing and painted as nothing -- `circle-opacity: 0` still
 * hit-tests, which is the entire trick. Put beneath the visible layers in the
 * style so it never affects what is drawn.
 */
export function hitLayer(): unknown {
  return {
    id: HIT_LAYER,
    type: 'circle',
    source: CAMERA_SOURCE,
    minzoom: CLUSTER_MIN_ZOOM,
    paint: {
      'circle-radius': HIT_RADIUS,
      'circle-opacity': 0,
      // A stroke of zero width still counts as no paint; both are needed or
      // MapLibre draws a default black ring.
      'circle-stroke-width': 0,
    },
  };
}

export function clusterCountLayer(palette: Palette, font: readonly string[]): unknown {
  return {
    id: CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: CAMERA_SOURCE,
    minzoom: CLUSTER_MIN_ZOOM,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': font,
      'text-size': 11,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': palette['--fwm-text'] },
  };
}

export interface CameraFeatureInput {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly ownerType?: string | undefined;
  readonly directionDeg?: number | null | undefined;
  readonly street?: string | undefined;
  readonly cross?: string | undefined;
  readonly tags?: Readonly<Record<string, string>> | undefined;
}

/**
 * Records to GeoJSON.
 *
 * The OSM tags ride along as feature properties, flattened with an `osm:`
 * prefix so a style expression can filter or colour on ANY of them --
 * `['get', 'osm:manufacturer']` is a working filter for "show me only Flock
 * Safety", with nothing in this file needing to know that tag exists. That is
 * the payoff for keeping the tags verbatim at ingest instead of bucketing them.
 */
export function toFeatureCollection(cameras: readonly CameraFeatureInput[]): unknown {
  const features = [];
  for (const camera of cameras) {
    if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) continue;
    const properties: Record<string, string | number> = { id: camera.id };
    if (typeof camera.ownerType === 'string') properties['ownerType'] = camera.ownerType;
    if (typeof camera.directionDeg === 'number') {
      properties['directionDeg'] = camera.directionDeg;
    }
    if (typeof camera.street === 'string') properties['street'] = camera.street;
    if (typeof camera.cross === 'string') properties['cross'] = camera.cross;
    for (const [key, value] of Object.entries(camera.tags ?? {})) {
      properties[`osm:${key}`] = value;
    }
    features.push({
      type: 'Feature',
      id: camera.id,
      geometry: { type: 'Point', coordinates: [camera.lon, camera.lat] },
      properties,
    });
  }
  return { type: 'FeatureCollection', features };
}

/* ===========================================================================
 * THE ALERT THRESHOLD, AS A RING ON THE GROUND
 *
 * The sweep dial has drawn this for as long as it has existed, and the map --
 * which replaced the dial as RADAR's ground -- never did. So a driver who
 * switched to the map lost the only picture of the setting they had, and the
 * threshold went back to being a number in SETTINGS that nothing on the
 * driving screen refers to.
 * ======================================================================== */

export const THRESHOLD_SOURCE = 'fwm-threshold';
export const THRESHOLD_LAYER = 'fwm-threshold-ring';

/** Metres in a foot. Exact by definition, not an approximation. */
export const M_PER_FT = 0.3048;

/**
 * Metres per degree of latitude. The meridian is very nearly constant, and the
 * error across the range this ring is ever drawn at -- a few hundred feet -- is
 * far below a pixel.
 */
const M_PER_DEG_LAT = 111_320;

/** How many points approximate the circle. 64 is smooth past any zoom the app allows. */
export const RING_POINTS = 64;

/**
 * A circle of `radiusFt` about a point, as a closed GeoJSON LineString.
 *
 * =========================================================================
 * WHY A POLYGON AND NOT `circle-radius`
 * =========================================================================
 * MapLibre's `circle-radius` is in SCREEN PIXELS. A ring drawn that way is a
 * fixed size on the glass and therefore a DIFFERENT ground distance at every
 * zoom -- so the one thing the ring exists to say, "the alert fires this far
 * out", would be wrong everywhere except the zoom it was tuned at, and would
 * change as the driver pinched. Nothing about that failure is visible; it just
 * quietly lies.
 *
 * Points in world coordinates are a true ground distance at every zoom,
 * because the projection does the work.
 *
 * The longitude scale is cut by cos(latitude) or the ring would be an ellipse
 * everywhere but the equator -- 21% too wide across the US, which is visible.
 */
export function thresholdRing(
  lat: number,
  lon: number,
  radiusFt: number,
  points: number = RING_POINTS,
): unknown {
  const empty = { type: 'FeatureCollection', features: [] };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return empty;
  if (!Number.isFinite(radiusFt) || radiusFt <= 0) return empty;

  const radiusM = radiusFt * M_PER_FT;
  const dLat = radiusM / M_PER_DEG_LAT;
  const cos = Math.cos((lat * Math.PI) / 180);
  // At a pole cos is 0 and every longitude is the same place. Nothing this app
  // ships serves a driver there, but a division by zero would produce Infinity
  // coordinates and take the whole style down, which is a worse outcome than a
  // ring that is merely wrong in a place nobody is.
  const dLon = Math.abs(cos) < 1e-6 ? dLat : radiusM / (M_PER_DEG_LAT * cos);

  const coordinates: [number, number][] = [];
  for (let i = 0; i <= points; i += 1) {
    // `<= points` closes the ring by repeating the first point, which is what
    // makes it a loop rather than an arc with a gap at due east.
    const angle = (i / points) * 2 * Math.PI;
    coordinates.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      },
    ],
  };
}

/**
 * The ring's paint.
 *
 * NEUTRAL, NOT AN ALERT HUE, and dashed -- the same two decisions the ladder's
 * threshold band makes, for the same reason. Everything else the map draws is a
 * reading; this is the driver's own setting, and in green it would read as the
 * product asserting the ground inside it is clear.
 *
 * The dash is in line-widths, so it stays a dash at every zoom rather than
 * stretching into a solid.
 */
export function thresholdLayer(palette: Palette): unknown {
  return {
    id: THRESHOLD_LAYER,
    type: 'line',
    source: THRESHOLD_SOURCE,
    paint: {
      'line-color': palette['--fwm-text-2'],
      'line-width': 1.5,
      'line-opacity': 0.55,
      'line-dasharray': [2, 3],
    },
  };
}
