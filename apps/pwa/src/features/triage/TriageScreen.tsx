/**
 * ALERT TRIAGE, wired to the real stores.
 *
 * =============================================================================
 * THIS FILE IS WIRING. IT IS NOT A MOCK, AND IT IS NOT A CALCULATOR.
 * =============================================================================
 * Like `RadarScreen.tsx` and `LogScreen.tsx`, this file:
 *
 *   - calls no browser API. No `navigator`, no `geolocation`, no notification,
 *     no permission prompt -- on mount or ever. There is not even a clock: the
 *     projection is a ratio of counted rows, and nothing on this screen is
 *     relative to "now".
 *   - does no geospatial arithmetic. The only distance it touches is the
 *     re-alert threshold, which is a stored setting, printed through RADAR's
 *     formatter.
 *   - renders no row it was not given, and prints no figure it did not count.
 *     With no drive on record the hero is an em dash, not a zero.
 *
 * =============================================================================
 * WHAT "PER DRIVE" MEANS HERE, AND WHY IT IS OFTEN AN EM DASH
 * =============================================================================
 * The history slice holds ONE trip -- the drive in progress or the last one it
 * was told about. It holds no list of past drives (those live in IndexedDB,
 * `services/db/repositories/trips.ts`, and are not loaded into this slice), so
 * the number of drives this screen can honestly divide by is one, or none.
 *
 * That is the same call `features/log/exposure.ts#scopedEntries` already made:
 * "a driver who has not started driving has no trip exposure, and showing the
 * whole log under a key labelled TRIP would be a lie about which drive those
 * cameras were on." Dividing the whole log by an invented drive count would be
 * the same lie with arithmetic on top.
 *
 * The consequence, stated plainly because the eyebrow says PROJECTED: while a
 * trip is OPEN the denominator is that one unfinished drive, so the hero is
 * "alerts so far on this drive". It reads 0 at the kerb and climbs as the drive
 * happens, and the `down from N` beside it is the same partial window with the
 * switches taken off -- a filtered/unfiltered comparison, never a this-drive
 * versus past-drives one. The caption line says `this drive so far` for exactly
 * as long as that is what the number is, and becomes the design's `with current
 * filters` once the trip has ended.
 * GAP: see docs/gaps-inbox/triage.md#drive-count-is-not-in-the-store
 *
 * The row captions use the WHOLE log, not the trip: `11 on your usual routes`
 * is a claim about roads this driver goes down, not about this morning.
 *
 * =============================================================================
 * MUTING, AND FILTERING, REMOVE THE ALERT AND NOTHING ELSE
 * =============================================================================
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *    count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 *    never the record."   -- Flockys Screens II.dc.html, B4
 *
 * The word `muted` appears nowhere in this feature's predicates. `cameraPasses`
 * is EXPOSURE's own predicate, imported rather than re-implemented, so a pass
 * counted on LOG is a pass counted here. Flipping an owner switch changes the
 * PROJECTED figure and the dimming of one headline; it changes no count, hides
 * no row, and writes nothing to any other slice.
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * No plate is read, rendered, logged or navigated to. Nothing is uploaded. The
 * two controls write two fields into the settings slice, which is persisted
 * through the guarded storage that refuses plate-shaped values. This screen
 * writes nothing to the URL -- not even its own id; the shell owns that.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { ComponentType, ReactElement } from 'react';

import {
  DEFAULT_SETTINGS,
  useAlertLog,
  useCachedCameras,
  useCurrentTrip,
  useOwnerTypesEnabled,
  useSettingsStore,
} from '../../stores';
import type { CameraOwnerType } from '../../stores';
import { cameraPasses, scopedEntries } from '../log';

import { TriageView } from './components/TriageView.tsx';
import type {
  OwnerRow,
  TriageViewHandlers,
  TriageViewModel,
  TriageViewProps,
} from './components/TriageView.tsx';
import {
  OWNER_LABELS,
  RE_ALERT_OFF_FT,
  TRIAGE_OWNER_TYPES,
  ownerCaption,
  projectAlerts,
  summariseOwners,
} from './triage.ts';
import type { OwnerLookup } from './triage.ts';

import './triage.css';

export type TriageScreenProps = TriageViewHandlers & {
  /**
   * WHICH VIEW DRAWS THE MODEL. Same seam and same reasoning as
   * `SettingsScreen`: the projection, the owner lookup and the re-alert restore
   * are all container work that v1 does not change, so v1 arrives as a second
   * VIEW over the same model. Defaults to v0's.
   */
  readonly view?: ComponentType<TriageViewProps> | undefined;
};

export function TriageScreen({
  onOwnerType,
  onReAlert,
  view: View = TriageView,
}: TriageScreenProps = {}): ReactElement {
  // --- the record ----------------------------------------------------------
  const entries = useAlertLog();
  const trip = useCurrentTrip();
  const cameras = useCachedCameras();

  // --- the switches --------------------------------------------------------
  const enabled = useOwnerTypesEnabled();
  // The settings slice publishes no selector for this one field. Reading the
  // store directly is the workaround: adding a selector would mean editing a
  // shared file that other screens are being built against right now.
  // GAP: see docs/gaps-inbox/triage.md#no-selector-for-re-alert-distance
  const reAlertFt = useSettingsStore((state) => state.reAlertWhenCloserThanFt);

  /**
   * Owner class for a camera id, or null when this device no longer holds the
   * record. Null is common and is NOT treated as "filtered out" -- see
   * `projectAlerts`.
   */
  const ownerOf = useMemo<OwnerLookup>(() => {
    const byId = new Map<string, CameraOwnerType>();
    for (const camera of cameras) {
      const ownerType = camera.ownerType;
      if (ownerType !== undefined) byId.set(camera.id, ownerType);
    }
    return (cameraId: string) => byId.get(cameraId) ?? null;
  }, [cameras]);

  // EXPOSURE's predicate, not a second one. The whole log for the row captions,
  // the open trip for the per-drive figure.
  const routePasses = useMemo(() => cameraPasses(entries), [entries]);
  const drivePasses = useMemo(
    () => cameraPasses(scopedEntries(entries, 'trip', trip)),
    [entries, trip],
  );

  const summary = useMemo(() => summariseOwners(routePasses, ownerOf), [routePasses, ownerOf]);

  const projection = useMemo(
    () =>
      projectAlerts({
        passes: drivePasses,
        ownerOf,
        enabled,
        // One drive, or none. See the note at the top of this file.
        drives: trip === null ? 0 : 1,
        // ...and while that one drive is still being driven, both figures are
        // running counts of a drive in progress, not a rate over drives. The
        // caption says which. `endedAtMs` is the trip slice's own field.
        driveInProgress: trip !== null && trip.endedAtMs === null,
      }),
    [drivePasses, ownerOf, enabled, trip],
  );

  const rows = useMemo<readonly OwnerRow[]>(
    () =>
      TRIAGE_OWNER_TYPES.map((ownerType) => ({
        ownerType,
        label: OWNER_LABELS[ownerType],
        caption: ownerCaption(ownerType, summary),
        // The switch. It decides the dimming and the PROJECTED figure. It does
        // not decide whether this row, or its count, exists.
        enabled: enabled[ownerType],
      })),
    [summary, enabled],
  );

  const model: TriageViewModel = useMemo(
    () => ({ projection, rows, reAlertFt }),
    [projection, rows, reAlertFt],
  );

  /**
   * The distance to restore when the re-alert switch comes back on.
   *
   * The design draws a switch; the model stores a distance, and off is stored
   * as zero. Without this, a driver who had chosen 300 ft, switched the row off
   * and switched it back on would silently be moved to the 150 ft default.
   * Session-scoped on purpose: it is a UI convenience, not a preference, and
   * preferences are the settings slice's to persist.
   */
  const restoreFt = useRef<number>(DEFAULT_SETTINGS.reAlertWhenCloserThanFt);

  const toggleReAlert = useCallback((on: boolean): void => {
    const settings = useSettingsStore.getState();
    if (!on) {
      if (settings.reAlertWhenCloserThanFt > RE_ALERT_OFF_FT) {
        restoreFt.current = settings.reAlertWhenCloserThanFt;
      }
      settings.setReAlertWhenCloserThanFt(RE_ALERT_OFF_FT);
      return;
    }
    const restore =
      restoreFt.current > RE_ALERT_OFF_FT
        ? restoreFt.current
        : DEFAULT_SETTINGS.reAlertWhenCloserThanFt;
    settings.setReAlertWhenCloserThanFt(restore);
  }, []);

  return (
    <View
      model={model}
      onOwnerType={onOwnerType ?? setOwnerType}
      onReAlert={onReAlert ?? toggleReAlert}
    />
  );
}

/** One boolean, into the settings slice. No network, no URL, no analytics. */
function setOwnerType(ownerType: CameraOwnerType, isEnabled: boolean): void {
  useSettingsStore.getState().setOwnerTypeEnabled(ownerType, isEnabled);
}
