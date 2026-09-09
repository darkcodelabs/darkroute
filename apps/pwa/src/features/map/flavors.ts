/**
 * THE TWO FLAVOURS THIS PROJECT DRAWS ITSELF.
 *
 * =============================================================================
 * WHY THERE ARE SEVEN FLAVOURS AND NOT FIVE
 * =============================================================================
 * `@protomaps/basemaps` publishes five -- black, dark, grayscale, light, white
 * -- and all five stay reachable, because `app/mapView.ts` is the driver's own
 * control and the reason to pick WHITE is that the sun is on the screen. None
 * of them is what the owner wants under SLATE or REFINEMENT, though, and the
 * gap is not a tint you can reach by overriding two ground keys:
 *
 *   Protomaps' DARK is a NEUTRAL grey map. earth #1f1f1f, water #31353f, every
 *   road class a grey between #1f1f1f and #474747. The reference is a deep
 *   NAVY ground with a saturated GREEN motorway on it and a road hierarchy
 *   built out of blues. Setting `earth` navy under grey roads gives a navy
 *   rectangle with the same grey map on it.
 *
 *   Protomaps' LIGHT is a warm near-white with white roads and grey casings,
 *   which is close -- and has no green in it anywhere. The whole point of the
 *   pair is that the arterial treatment is the SAME green in both lights, so
 *   the two skins read as one product rather than as two maps.
 *
 * So: two real flavours, derived from `dark` and `light` so every key nobody
 * has an opinion about keeps a sane upstream value instead of becoming
 * undefined, and overridden everywhere the references actually differ.
 *
 * =============================================================================
 * WHERE THE COLOURS LIVE, AND WHY THEY ARE NOT WRITTEN HERE
 * =============================================================================
 * `tokens.css` is the only file in this repo allowed to contain a raw colour,
 * and `check-design-values.mjs` enforces that on `.ts` as hard as on `.css` --
 * a hand-written `#162640` in this file is a build failure, which was measured
 * rather than assumed.
 *
 * That rule is also just right here. These are not opaque constants; they are
 * the same design system the chrome is drawn from, and the ground the app
 * paints under the archive (`--fwm-map-earth`) has to AGREE with the ground the
 * flavour declares or the map has a seam in it while tiles load. Binding
 * `[data-fwm-mode="slate"] { --fwm-map-earth: var(--fwm-carto-slate-earth) }`
 * makes that agreement structural instead of a thing somebody remembers.
 *
 * =============================================================================
 * TWENTY DECISIONS, NOT SEVENTY-FOUR KEYS
 * =============================================================================
 * A flavour is 74 keys, and transcribing 148 hex values into `tokens.css` would
 * be 148 chances to get one wrong and no way to see the hierarchy. Most of
 * those keys are the same decision repeated: a bridge is drawn like the road it
 * carries, a tunnel like the road it hides, `minor_a` and `minor_b` are one
 * choice about how far back minor roads sit.
 *
 * So the tokens are the CARTOGRAPHIC ROLES below -- twenty per flavour -- and
 * this module expands them into the 74. Retuning "how far back do minor roads
 * sit" is then one token, not the six keys that would drift apart.
 */

import { namedFlavor } from '@protomaps/basemaps';
import type { Flavor } from '@protomaps/basemaps';

import { readTokens } from './palette.ts';

/** The five `@protomaps/basemaps` ships. The driver can pick any of them. */
export type StockFlavorName = 'black' | 'dark' | 'grayscale' | 'light' | 'white';

/**
 * The two drawn here, named for the skin each was drawn FOR.
 *
 * They are deliberately NOT in `FWM_MAP_VIEWS`: that union is the driver's
 * explicit override, and "slate" as a thing to pick off a list would be a
 * cartography named after a palette, which is the confusion `app/mapView.ts`
 * opens by warning about. These are what `auto` resolves those two themes to.
 */
export type CustomFlavorName = 'slate' | 'refinement';

export type FlavorName = StockFlavorName | CustomFlavorName;

const CUSTOM_FLAVORS: readonly CustomFlavorName[] = ['slate', 'refinement'];

export function isCustomFlavor(name: string): name is CustomFlavorName {
  return (CUSTOM_FLAVORS as readonly string[]).includes(name);
}

/**
 * THE TWENTY DECISIONS A FLAVOUR MAKES.
 *
 * Ordered as the map is read: ground, then the road network from loudest to
 * quietest, then the writing, then the land the archive does not carry.
 */
export const CARTO_ROLES = [
  /** The ground. Also bound to `--fwm-map-earth` by the mode that uses it. */
  'earth',
  /** Rivers, lakes and the sea. Also bound to `--fwm-map-water`. */
  'water',
  /** Motorway and its ramps: the green both references are built around. */
  'motorway',
  'motorway-casing',
  /** The section-line grid that carries the traffic between motorways. */
  'arterial',
  'arterial-casing',
  /** Residential streets. The class that must sit BACK from the arterials. */
  'minor',
  'minor-casing',
  /** Service roads, tracks, piers: the quietest thing still worth drawing. */
  'quiet',
  'rail',
  'boundary',
  /** City names: the brightest writing on the map. */
  'ink',
  /** Neighbourhood names. */
  'ink-2',
  /** Road names, and the number inside a shield -- one key does both. */
  'ink-3',
  /** Minor road names and house numbers: the writing that may be missed. */
  'ink-4',
  /** Every halo. One value: a halo is the ground, thickened. */
  'halo',
  /** ABSENT BY CONSTRUCTION -- see the note on `landuse` below. */
  'park',
  'park-2',
  'built',
  'sand',
] as const;

export type CartoRole = (typeof CARTO_ROLES)[number];

export type CartoToken = `--fwm-carto-${CustomFlavorName}-${CartoRole}`;

export function cartoToken(flavor: CustomFlavorName, role: CartoRole): CartoToken {
  return `--fwm-carto-${flavor}-${role}`;
}

/**
 * Every token the two flavours need, for the test that checks `tokens.css`
 * actually defines them.
 *
 * `check-design-values.mjs` cannot catch a typo here. It verifies that a
 * `var(--fwm-*)` written in CSS resolves, and these are read by name from
 * JavaScript -- a misspelt role would resolve to the empty string, fall back to
 * `FALLBACK_COLOUR`, and ship a map with one grey road class on it.
 */
export const CARTO_TOKENS: readonly CartoToken[] = CUSTOM_FLAVORS.flatMap((flavor) =>
  CARTO_ROLES.map((role) => cartoToken(flavor, role)),
);

type Carto = Readonly<Record<CartoRole, string>>;

/** The twenty values for one flavour, read off the document. */
function readCarto(flavor: CustomFlavorName, element?: Element | null): Carto {
  const names = CARTO_ROLES.map((role) => cartoToken(flavor, role));
  const raw = readTokens(names, element);
  const out: Record<string, string> = {};
  for (const role of CARTO_ROLES) out[role] = raw[cartoToken(flavor, role)];
  return out as Carto;
}

/**
 * The twenty roles, expanded into the keys `layers()` actually reads.
 *
 * =============================================================================
 * WHAT THE PARK AND COMMERCIAL COLOURS ARE FOR, GIVEN THEY PAINT NOTHING
 * =============================================================================
 * Both references are full of green parks and tan commercial blocks, and this
 * flavour CANNOT DRAW THEM. The shipped archive is built with `tile-join
 * --exclude-layer` for `buildings`, `pois` and `landuse`, and
 * `OMITTED_SOURCE_LAYERS` in `basemap.ts` is the style's side of that. Land use
 * was measured at 47% of source bytes; re-adding it takes the archive from
 * 4.5 GB to about 8.5 GB, for ground texture a driving instrument never reads.
 *
 * So `park`, `park-2`, `built` and `sand` feed `park_a`, `wood_b`, `school`,
 * `beach` and the rest, and every one of those layers is filtered out of the
 * style before MapLibre sees it. They are set from the references anyway --
 * measured off the real pixels like everything else -- so the flavour is honest
 * about what it WOULD draw if that layer ever arrived, rather than carrying
 * upstream's neutral greys as a lie about a decision nobody made.
 *
 * `landcover` is the exception that is NOT decorative. It is a different source
 * layer and it IS in the archive -- the PMTiles metadata lists exactly
 * `boundaries, earth, landcover, places, roads, water`, which is quoted in full
 * on `OMITTED_SOURCE_LAYERS` -- and it fades out between z5 and z7. `MIN_ZOOM`
 * is 3, so a driver who pinches all the way out to see the country DOES see it,
 * and leaving it at upstream's greys would put a grey continent under a navy
 * map. It is set from the same four roles.
 */
function expand(c: Carto): Partial<Flavor> {
  return {
    // THE GROUND. `styleFor` overwrites these three from `--fwm-map-earth` and
    // `--fwm-map-water`, which the mode binds to these same tokens -- so this
    // is not dead, it is the half of that agreement that lives here.
    background: c.earth,
    earth: c.earth,
    water: c.water,

    // ---- land the archive does not carry. See the note above. ----
    park_a: c.park,
    park_b: c['park-2'],
    wood_a: c.park,
    wood_b: c['park-2'],
    scrub_a: c.park,
    scrub_b: c['park-2'],
    zoo: c['park-2'],
    hospital: c.built,
    industrial: c.built,
    school: c.built,
    military: c.built,
    pedestrian: c.built,
    aerodrome: c.built,
    buildings: c.built,
    sand: c.sand,
    beach: c.sand,
    glacier: c.sand,
    runway: c.quiet,
    landcover: {
      grassland: c.park,
      barren: c.sand,
      urban_area: c.built,
      farmland: c.park,
      glacier: c.sand,
      scrub: c.park,
      forest: c['park-2'],
    },

    // ---- tunnels: the road, hidden. Casing darker than any surface road so a
    // tunnel reads as something the network goes INTO rather than over. ----
    tunnel_other_casing: c['minor-casing'],
    tunnel_minor_casing: c['minor-casing'],
    tunnel_link_casing: c['motorway-casing'],
    tunnel_major_casing: c['arterial-casing'],
    tunnel_highway_casing: c['motorway-casing'],
    tunnel_other: c.quiet,
    tunnel_minor: c.minor,
    tunnel_link: c.motorway,
    tunnel_major: c.arterial,
    tunnel_highway: c.motorway,

    // ---- the surface network, quietest first ----
    pier: c.quiet,
    minor_service_casing: c['minor-casing'],
    minor_casing: c['minor-casing'],
    link_casing: c['motorway-casing'],
    major_casing_late: c['arterial-casing'],
    highway_casing_late: c['motorway-casing'],
    major_casing_early: c['arterial-casing'],
    highway_casing_early: c['motorway-casing'],
    other: c.quiet,
    minor_service: c.quiet,
    minor_a: c.minor,
    minor_b: c.minor,
    // A RAMP IS PART OF THE MOTORWAY, and both references draw it that way --
    // the green runs continuously through every interchange. Upstream splits
    // `link` off into the major-road colour, which breaks a cloverleaf into
    // four green stubs joined by grey.
    link: c.motorway,
    major: c.arterial,
    highway: c.motorway,
    railway: c.rail,
    boundaries: c.boundary,

    // ---- bridges: drawn as the road they carry, so a flyover does not change
    // class halfway across. ----
    bridges_other_casing: c['minor-casing'],
    bridges_minor_casing: c['minor-casing'],
    bridges_link_casing: c['motorway-casing'],
    bridges_major_casing: c['arterial-casing'],
    bridges_highway_casing: c['motorway-casing'],
    bridges_other: c.quiet,
    bridges_minor: c.minor,
    bridges_link: c.motorway,
    bridges_major: c.arterial,
    bridges_highway: c.motorway,

    // ---- the writing ----
    roads_label_minor: c['ink-4'],
    roads_label_minor_halo: c.halo,
    // ALSO THE SHIELD NUMBER. `layers()` paints `roads_shields` and
    // `roads_labels_major` from this one key, which is why the sprite is not a
    // free choice -- see `spriteFlavor`.
    roads_label_major: c['ink-3'],
    roads_label_major_halo: c.halo,
    ocean_label: c['ink-3'],
    subplace_label: c['ink-2'],
    subplace_label_halo: c.halo,
    city_label: c.ink,
    city_label_halo: c.halo,
    state_label: c['ink-3'],
    state_label_halo: c.halo,
    country_label: c['ink-2'],
    address_label: c['ink-4'],
    address_label_halo: c.halo,
  };
}

/**
 * The flavour object `layers()` wants, for any of the seven names.
 *
 * The five stock ones are handed straight back from the package. The two custom
 * ones are `dark`/`light` with the expansion above laid over them, so a key
 * neither reference has an opinion about -- `taxiway`, the POI palette -- keeps
 * a value that at least belongs to a map of the right polarity.
 */
export function flavorFor(name: FlavorName, element?: Element | null): Flavor {
  if (!isCustomFlavor(name)) return namedFlavor(name);
  const base = namedFlavor(name === 'slate' ? 'dark' : 'light');
  /* RETURNS `Flavor`, NOT `unknown`, and that is the difference between this
     compiling and not. `layers()` takes a `Flavor`; handing it a value widened
     to `Record<string, unknown>` drops all 74 keys and it is rejected as
     missing every one of them. A spread needs no widening -- `{ ...base }`
     copies exactly what `Flavor` declares -- so the type survives the
     override, and `expand` returning `Partial<Flavor>` is what makes the
     result still complete. */
  return { ...base, ...expand(readCarto(name, element)) };
}

/**
 * WHICH SPRITE SHEET A FLAVOUR TRAVELS WITH, AND WHY IT IS NOT FREE.
 *
 * `basemap.ts` records that sprite colour is baked into the pixels -- nothing
 * in the sheet carries an `sdf` flag, so `icon-color` cannot repaint it -- and
 * that black shields on a near-white ground is the failure mode. There is a
 * sharper version of that rule for these two, and it is mechanical rather than
 * aesthetic:
 *
 *   `roads_label_major` PAINTS TWO THINGS. It is the road name written along
 *   the road AND the number inside the shield. One key, and the sheets pick
 *   sides: black/dark/grayscale ship a #000000 shield, light/white a #FFFFFF
 *   one. On a navy ground the road names must be light, so the shield must be
 *   dark or the number vanishes into it. There is no third option.
 *
 * SLATE TAKES `black`, NOT `dark`. Their shields are byte-identical -- both
 * #000000 with a #292929 rim -- and `black.json` is 18 icons in 5,697 B against
 * `dark.json`'s 53 in 16,054 B. The extra 35 are POI tiles for a source layer
 * this archive does not contain, so they are bytes on the wire for artwork that
 * cannot be drawn. It is also the sheet the app already ships as `SPRITE_PATH`.
 *
 * REFINEMENT KEEPS `light`, WHICH IS THE HEAVIER OF ITS PAIR, on purpose. Its
 * shields are #FFFFFF with a #D6D6D6 rim; `white`'s are #FFFFFF with #E2E2E2.
 * Against this ground (#F2F6F2, L=95%) that rim is the entire difference
 * between a shield and a floating number -- roughly 10 points of lightness
 * against 5. The reference's shields have a definite edge. Ten kilobytes buys
 * it, and it is the sheet `refinement` already loads, so the vendored matrix
 * `check-basemap-assets.mjs` guards does not change either.
 */
export function spriteFlavor(name: FlavorName): StockFlavorName {
  if (name === 'slate') return 'black';
  if (name === 'refinement') return 'light';
  return name;
}
