/**
 * WHICH CAMERAS THE MAP DRAWS - and nothing else in the app.
 *
 * =============================================================================
 * THE ONE THING THIS FILE MUST NEVER BECOME
 * =============================================================================
 * This is a DRAWING filter. It decides which records go into the GeoJSON source
 * under the map. It does not decide which cameras are assessed, measured,
 * queued, counted or warned about, and it must never be plumbed anywhere that
 * does.
 *
 * The failure it would cause is the worst this app can ship, and it would look
 * like the feature working: a driver narrows the map to "police / agency" to
 * see who owns what, forgets, and drives past an HOA reader the app no longer
 * warns them about. Every camera stays in the engine, always. The two nearest
 * are drawn by their own DOM markers off the assessments, so whatever is being
 * warned about stays on the map even when its owner class is hidden - see the
 * comment guarding `labelled` in `DriveScreen.tsx`.
 *
 * The alerting filter is a DIFFERENT setting with a different name:
 * `settings.ownerTypesEnabled`, read by TRIAGE and SETTINGS. The two are never
 * to be merged, aliased or read by one component. If a reviewer sees two owner
 * filters and wants to unify them, that unification is the defect this file
 * exists to keep out.
 *
 * =============================================================================
 * WHY THE SOURCE ARRAY AND NOT A MAPLIBRE LAYER FILTER
 * =============================================================================
 * Clustering happens at the SOURCE (`MapCanvas.tsx`, the `cluster` option), and
 * supercluster is blind to a layer `filter`. `clusterCountLayer` PRINTS
 * `point_count`, so with a layer filter a driver filtering to police would read
 * a cluster labelled 14 that holds 3 police cameras - a fabricated number on
 * the screen used at speed. Filtering the array re-clusters the visible set and
 * the printed count is true by construction.
 *
 * It also keeps the invisible 44px hit layer honest for free (`HIT_LAYER` has
 * no filter of its own, so a layer-filtered camera would stay tappable through
 * nothing), and it needs no `setFilter` to be re-applied across the three style
 * rebuild paths that already re-read `camerasRef.current`.
 *
 * KNOWN LIMIT, FAILING OPEN. Below zoom 11 the map swaps its data for
 * `/cameras/overview.json`, whose features carry no properties at all and so
 * carry no owner. Zoomed out to the country the heat field shows everything
 * regardless of this filter. That draws MORE than the filter promises, never
 * less, so it cannot cause the safety failure above - but it is a visible
 * inconsistency and it is written down.
 * GAP: docs/gaps-inbox/map-owner-filter.md
 */

import type { CameraOwnerType } from '../../services/db/schema.ts';

/** The chosen class, or `null` for "draw everything". */
export type MapOwnerFilter = CameraOwnerType | null;

/**
 * The records the map should draw.
 *
 * `null` means everything, INCLUDING the records whose owner nobody has
 * recorded - which is most of them, since OSM's ALPR nodes usually carry no
 * `operator`. That is why the filter is one nullable value rather than five
 * booleans: a record of flags cannot say "everything, unrecorded included"
 * without a sixth key meaning something different from the other five.
 *
 * A record with no `ownerType` is excluded by every non-null filter. It is not
 * treated as `unverified`: `unverified` is a class somebody asserted, absence
 * is the absence of an assertion, and this file does not turn one into the
 * other. (`layers.ts` colours both with the same quiet hue, which is a drawing
 * decision, not a claim about the data.)
 *
 * RETURNS THE INPUT REFERENCE UNCHANGED WHEN THE FILTER IS NULL. That is not a
 * micro-optimisation, it is load-bearing: `MapCanvas`'s data effect is keyed on
 * the `cameras` prop by identity, so a freshly allocated array on every render
 * would push the whole archive through `setData` on every render - which is the
 * default case, with no filter set.
 */
export function visibleCameras<T extends { readonly ownerType?: string | undefined }>(
  cameras: readonly T[],
  filter: MapOwnerFilter,
): readonly T[] {
  if (filter === null) return cameras;
  return cameras.filter((camera) => camera.ownerType === filter);
}
