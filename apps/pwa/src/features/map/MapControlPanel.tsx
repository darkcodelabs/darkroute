/**
 * THE MAP CONTROL PANEL - the one place that answers "what is the map showing".
 *
 * =============================================================================
 * WHAT IT REPLACED, AND WHY THE CYCLE WAS NOT WORTH KEEPING
 * =============================================================================
 * The rail's layers key used to CYCLE the cartography: one press, the next of
 * six flavours. That is the right control for two states and the wrong one for
 * six. Reaching a named flavour cost up to five presses, and the only place its
 * name appeared ON DRIVE was the key's `aria-label` - so a sighted driver could
 * not tell which of the six they were on except by looking at the ground under
 * the map.
 *
 * CORRECTION, because the first version of this comment said `MAP_VIEW_NOTES`
 * "had no reader at all" and that is false: `SettingsViewV1.tsx:437` renders
 * the note for the current flavour, and `:434` and `:453` render the labels.
 * What was missing was never the reader - it was reaching them without leaving
 * the driving screen, which is the only screen you are on while deciding that
 * the ground is too bright.
 *
 * The key now opens this. Both questions it answers - which cameras are drawn,
 * and what they are drawn on - are the same question, so they get one key
 * rather than a sixth and seventh control on the screen used at speed.
 *
 * =============================================================================
 * THE THING THIS PANEL MUST NEVER BE ALLOWED TO BECOME
 * =============================================================================
 * The owner rows are a DRAWING filter. They change which records go into the
 * map's GeoJSON source and nothing else. Every camera stays in the engine, is
 * still measured, still queued, still counted and still warned about.
 *
 * There is a second owner filter in this app - `settings.ownerTypesEnabled`,
 * which governs ALERTING and is read by TRIAGE and SETTINGS. The two have
 * deliberately different names and this file must never import
 * `setOwnerTypeEnabled` or `useOwnerTypesEnabled`. Merging them turns a
 * cosmetic control into the defect the whole feature was written to avoid: a
 * driver who narrowed the map to police, forgot, and drove past an HOA reader
 * in silence. `features/map/ownerFilter.ts` carries the same warning at the
 * other end of the wire.
 *
 * Which is why the display-only sentence is not conditional. It is drawn
 * whatever is selected, because a filter that only explains itself once it is
 * hiding something has already hidden it.
 *
 * =============================================================================
 * NOT AN OVERLAY
 * =============================================================================
 * This is a plain positioned block inside DRIVE, not `openOverlay`. An overlay
 * covers the map, and the value of this control is watching the dots change as
 * you tap; overlays are also saved and re-raised around an alert takeover
 * (`app/screenState.ts`), so a filter panel would reappear over the road right
 * after a camera alert - a control the driver did not ask for at the worst
 * moment to be given one.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { ReactElement, RefObject } from 'react';

import { FWM_MAP_VIEWS, MAP_VIEW_LABELS, MAP_VIEW_NOTES } from '../../app/mapView.ts';
import {
  OWNER_TYPES,
  useCachedCameras,
  useMapOwnerFilter,
  useMapView,
  useSettingsStore,
} from '../../stores/index.ts';
import type { CameraOwnerType } from '../../stores/index.ts';
import { OWNER_LABELS } from '../triage/triage.ts';

import './mapControlPanel.css';

/** The group's accessible name. The rail key says which panel it opens. */
export const MAP_PANEL_LABEL = 'map';

export const MAP_PANEL_DRAWS = 'WHAT THE MAP DRAWS';
export const MAP_PANEL_VIEWS = 'MAP VIEW';

/**
 * The denominator, said out loud.
 *
 * The counts on these rows are what is cached on THIS PHONE, not what exists,
 * and a figure beside a filter reads as a total unless something says
 * otherwise. Look up's count line makes the same admission for the same reason.
 */
export const MAP_PANEL_ON_PHONE = 'on this phone';

/** `null` - everything, including the cameras whose owner nobody recorded. */
export const MAP_PANEL_ALL = 'All owners';

/**
 * THE SENTENCE THE WHOLE FEATURE TURNS ON, and it is never conditional.
 *
 * A driver filters the map, forgets, and the app's one job is still to warn
 * them. This says the filter cannot touch that. It is on screen whatever is
 * selected, including "All owners", because a control that explains itself only
 * while it is hiding something is a control that has already misled somebody.
 */
export const MAP_PANEL_DISPLAY_ONLY =
  'this only changes what is DRAWN. every camera is still watched, still measured and still ' +
  'warned about, including the ones hidden here. the two closest stay on the map whatever you ' +
  'pick, because a warning you cannot see on the map is worse than a filter that does not tidy.';

/** Said under the rows when the chosen class has nothing in it on this phone. */
export const MAP_PANEL_EMPTY =
  'no cameras of this kind are on this phone yet. the map is empty until you drive somewhere ' +
  'that has one - it is not hiding anything else.';

/**
 * The limit, stated rather than hidden.
 *
 * Below zoom 11 the map swaps its data for `/cameras/overview.json`, whose
 * features carry no properties and therefore no owner, so that field cannot be
 * filtered at all. It fails OPEN - more is drawn than the filter promises,
 * never less - so it cannot cause the safety failure above, but a driver who
 * zooms out and sees dots they thought they had hidden deserves the reason.
 * GAP: docs/gaps-inbox/map-owner-filter.md
 */
export const MAP_PANEL_ZOOM_CAVEAT =
  'zoomed out past street level the map draws the national field, which carries no owner data ' +
  'and is not filtered.';

export interface MapControlPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * The control that opened this, so focus can be put back on it.
   *
   * Required rather than optional: a panel that goes `inert` while one of its
   * own buttons holds focus drops that focus on the floor, and the reader who
   * loses it is exactly the one this panel's copy was written for. Making it
   * optional would let a caller forget, silently.
   */
  readonly returnFocusTo: RefObject<HTMLButtonElement | null>;
}

export function MapControlPanel({
  open,
  onClose,
  returnFocusTo,
}: MapControlPanelProps): ReactElement {
  const mapOwnerFilter = useMapOwnerFilter();
  const mapView = useMapView();
  const setMapOwnerFilter = useSettingsStore((s) => s.setMapOwnerFilter);
  const setMapView = useSettingsStore((s) => s.setMapView);

  /**
   * THE UNFILTERED ARCHIVE, and it must stay that way.
   *
   * These counts are the panel's own reading of what is cached. They come from
   * the same selector DRIVE uses for its record lookups and its WATCHING pill,
   * before any drawing filter is applied - a count that shrank as you filtered
   * would be answering a different question from the one the row asks.
   */
  const cameras = useCachedCameras();

  const counts = useMemo(() => {
    const tally = new Map<CameraOwnerType, number>();
    for (const camera of cameras) {
      if (camera.ownerType === undefined) continue;
      tally.set(camera.ownerType, (tally.get(camera.ownerType) ?? 0) + 1);
    }
    return tally;
  }, [cameras]);

  /**
   * CLOSING PUTS FOCUS BACK ON THE KEY THAT OPENED IT.
   *
   * Every row shuts the panel from inside its own click handler, and the
   * container takes `inert` in the same commit - so the button that had focus
   * became unfocusable and focus fell to `<body>`. Escape did the same. A
   * sighted driver never noticed; a screen-reader driver was returned to the
   * top of the document with no idea the panel had gone.
   *
   * Wrapped so every caller gets it: the rows and Escape both go through this
   * rather than through `onClose` directly.
   */
  const closeAndRestore = useCallback((): void => {
    onClose();
    returnFocusTo.current?.focus();
  }, [onClose, returnFocusTo]);

  /**
   * ESCAPE SHUTS IT. There is no scrim to tap - a scrim is a thing covering the
   * map - so the keyboard needs a way out that is not hunting for the key that
   * opened it. Bound on the document rather than on the panel because the panel
   * does not take focus when it opens.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeAndRestore();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeAndRestore]);

  return (
    <div
      className="fwm-drive-panel"
      role="group"
      aria-label={MAP_PANEL_LABEL}
      data-fwm-open={String(open)}
      /* CSS hides it with `visibility`, which is enough in a browser. These two
         are for everything that does not run the stylesheet - the test
         environment among them - so a shut panel is never a set of controls a
         reader or a tab key can reach. */
      aria-hidden={!open}
      inert={!open}
    >
      <section className="fwm-drive-panel-section" aria-label="what the map draws">
        <p className="fwm-drive-panel-kicker fwm-data">{MAP_PANEL_DRAWS}</p>
        <p className="fwm-drive-panel-sub fwm-data">{MAP_PANEL_ON_PHONE}</p>

        {/* ALL OWNERS IS THE ONLY ROW THAT INCLUDES THE UNRECORDED ONES, which
            is most of them: OSM's ALPR nodes rarely carry an `operator`. That
            is why the filter is one nullable choice and not five switches. */}
        <button
          type="button"
          className="fwm-drive-panel-row"
          aria-pressed={mapOwnerFilter === null}
          onClick={() => {
            setMapOwnerFilter(null);
            closeAndRestore();
          }}
        >
          <span className="fwm-drive-panel-dot" data-fwm-owner="all" aria-hidden="true" />
          <span className="fwm-drive-panel-row-label">{MAP_PANEL_ALL}</span>
          <span className="fwm-drive-panel-row-count fwm-data">{String(cameras.length)}</span>
        </button>

        {/* FIVE ROWS, not the three a first reading of the brief would give.
            `OWNER_TYPES` is five and Look up already offers all five; shipping
            three would leave the map and Look up disagreeing about what an
            owner is, and would leave no way to isolate `unverified`. */}
        {OWNER_TYPES.map((owner) => (
          <button
            key={owner}
            type="button"
            className="fwm-drive-panel-row"
            aria-pressed={mapOwnerFilter === owner}
            onClick={() => {
              setMapOwnerFilter(owner);
              // Shut on choosing: the answer is on the map behind this pane,
              // and a driver who has just narrowed it wants to see it.
              closeAndRestore();
            }}
          >
            <span className="fwm-drive-panel-dot" data-fwm-owner={owner} aria-hidden="true" />
            <span className="fwm-drive-panel-row-label">{OWNER_LABELS[owner]}</span>
            <span className="fwm-drive-panel-row-count fwm-data">
              {String(counts.get(owner) ?? 0)}
            </span>
          </button>
        ))}

        {/* A ZERO ROW IS SELECTABLE, so the empty result needs saying.
            Pressing a class with no cameras on the phone empties the map, and
            nothing else on screen explains why - the count that would have
            warned you is back inside this panel, which has just closed. */}
        {mapOwnerFilter !== null && (counts.get(mapOwnerFilter) ?? 0) === 0 ? (
          <p className="fwm-drive-panel-empty fwm-data">{MAP_PANEL_EMPTY}</p>
        ) : null}
      </section>

      {/* MAP VIEW IS SECONDARY AND COLLAPSED BY DEFAULT. It is useful as an
          escape hatch while the cartography switcher is being repaired, but it
          must not consume most of this small panel or force a permanent-looking
          scrollbar beside the owner control somebody actually opened. Native
          details keeps the closed state honest without another preference. */}
      <details className="fwm-drive-panel-disclosure">
        <summary className="fwm-drive-panel-disclosure-key">
          <span className="fwm-drive-panel-kicker fwm-data">{MAP_PANEL_VIEWS}</span>
          <span className="fwm-drive-panel-disclosure-value fwm-data">
            {MAP_VIEW_LABELS[mapView]}
          </span>
          <span className="fwm-drive-panel-disclosure-chevron" aria-hidden="true">
            ›
          </span>
        </summary>

        <section className="fwm-drive-panel-section" aria-label="cartography">
          {/* THIS ONE DOES NOT SHUT THE PANEL. Choosing a cartography is a
              comparison - the reason the old control was a cycle at all - and
              closing after every press would put the key back between the driver
              and the next flavour. The owner rows are a decision, not a
              comparison, so those do close. */}
          {FWM_MAP_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              className="fwm-drive-panel-row fwm-drive-panel-view"
              aria-pressed={view === mapView}
              onClick={() => {
                setMapView(view);
              }}
            >
              <span className="fwm-drive-panel-row-label">{MAP_VIEW_LABELS[view]}</span>
              <span className="fwm-drive-panel-row-note fwm-data">{MAP_VIEW_NOTES[view]}</span>
            </button>
          ))}
        </section>
      </details>

      <p className="fwm-drive-panel-note fwm-data">{MAP_PANEL_DISPLAY_ONLY}</p>
      <p className="fwm-drive-panel-note fwm-data" data-fwm-quiet="true">
        {MAP_PANEL_ZOOM_CAVEAT}
      </p>
    </div>
  );
}
