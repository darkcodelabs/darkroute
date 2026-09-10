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
 * IT IS THE MENU LANGUAGE, NOT A THIRD PANEL LANGUAGE
 * =============================================================================
 * Every row here is one of `features/chrome/Menu.tsx`'s six types, and this
 * file hard-codes no geometry and no colour of its own - the arrangement
 * `AbuseMenu.tsx` already runs on. Three chips sit under the search bar and
 * each one opened a panel written in its own private markup, which is the whole
 * reason the three read as three products: different header, different row
 * fill, different switch, different type.
 *
 * The SHELL is still this panel's own and still in `mapControlPanel.css` -
 * where it sits, how wide it is, how it arrives and leaves - because the three
 * shells are genuinely different: abuse anchors to the left inset, this one is
 * held clear of the rail so it cannot cover the key that opens it, and map view
 * sits on the right inset. What is INSIDE the shell is the language, and the
 * shell no longer draws a surface of its own because the menu draws one.
 *
 * WHAT THE LANGUAGE DOES NOT HAVE, and it is one thing: a filter row for a
 * choice that is not a taxon. `All owners` is not an owner class - `MenuOwner`
 * has five members and none of them means "everything" - so that row is handed
 * the class it is not, and its dot is redrawn as a hollow ring by this panel's
 * own stylesheet. The note is beside the rule.
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

import {
  Menu,
  MenuFilter,
  MenuGroup,
  MenuHeader,
  MenuNavigate,
  MenuNote,
  MenuRule,
  MenuSelect,
  MenuToggle,
} from '../chrome/Menu.tsx';
import type { MenuOwner } from '../chrome/Menu.tsx';
import {
  OWNER_TYPES,
  useCachedCameras,
  useMapOwnerFilter,
  useSettingsStore,
} from '../../stores/index.ts';
import type { CameraOwnerType } from '../../stores/index.ts';
import { OWNER_LABELS } from '../triage/triage.ts';

import { MonitoringControls } from './MonitoringControls.tsx';
import './mapControlPanel.css';

/** The group's accessible name. The rail key says which panel it opens. */
export const MAP_PANEL_LABEL = 'map';

export const MAP_PANEL_DRAWS = 'WHAT THE MAP DRAWS';

/**
 * The choice set's accessible name, which is the header's said in prose.
 *
 * It was a `<section>` and is now a {@link MenuGroup}, so it announces as a
 * group rather than as a region. The name is unchanged: it is what tells a
 * reader that the six rows under it are six answers to one question rather
 * than six unrelated switches.
 */
export const MAP_PANEL_GROUP = 'what the map draws';

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
/**
 * THE ONE SENTENCE THAT HAS TO SURVIVE.
 *
 * Two paragraphs stood here - a display-only explanation and a zoom caveat -
 * and together they were most of the panel's height, in prose, under the
 * controls somebody opened the panel to press. They read as a disclaimer and
 * got skipped, which is the worst outcome for text whose job is safety.
 *
 * The SAFETY FACT is not optional and is kept: hiding an owner class changes
 * the picture and not the warnings. Six words carry that where sixty did not,
 * because a line short enough to be read is worth more than a paragraph that
 * is accurate and ignored.
 */
export const MAP_PANEL_DISPLAY_ONLY = 'display only — every camera is still watched';

/**
 * Said under the rows when the chosen class has nothing in it on this phone.
 *
 * A zero row is selectable, and pressing one empties the map. Nothing else on
 * screen explains why - the count that would have warned you is inside this
 * panel, which has just closed - so this is the one place the empty result can
 * be accounted for.
 */
export const MAP_PANEL_EMPTY =
  'none of this kind on this phone yet — the map is not hiding anything else.';


/**
 * THE WAY OUT TO THE THEMING, WHICH IS NOT HERE ANY MORE.
 *
 * Six cartography rows with a paragraph of prose each is most of a small panel
 * spent on a thing chosen once, and it pushed the owner filter - the control
 * somebody actually opened this for - behind a scroll. Every one of those rows
 * already exists in SETTINGS next to the palette, which is where a person
 * looking to change how the app LOOKS goes anyway.
 *
 * So this panel keeps what belongs to the map right now, and points at the
 * place that owns appearance rather than keeping a second copy of it.
 */
/**
 * ROADWORK, AND NOT ONE WORD ABOUT POLICE.
 *
 * The layer was asked for as a police-presence layer. The research is
 * unambiguous that the data does not exist: Kansas publishes zero police
 * strings across 97 live collections, Missouri 1,135 records with no match for
 * police, trooper or sheriff, and the WZDx standard has two event types which
 * are both work zones.
 *
 * So the control says what the data is. A screenshot of a toggle reading
 * POLICE ACTIVITY over a layer of work zones is exactly the claim this project
 * spends its documentation refusing to make, and the label is what ends up in
 * an article.
 */
export const PANEL_HAZARDS = 'Roadwork';
export const PANEL_HAZARDS_ON = 'closures and work zones, where covered';
export const PANEL_HAZARDS_OFF = 'off — not a police layer, no such feed exists';
/** Said when the driver is outside every state the layer has a feed for. */
export const PANEL_HAZARDS_UNCOVERED = 'no feed for this state — blank means unknown, not clear';


export const PANEL_THEME = 'Set theme';
export const PANEL_THEME_NOTE = 'palette and map cartography, in settings';

/**
 * THE APP'S OWNER CLASSES, IN THE MENU LANGUAGE'S OWN WORDS FOR THEM.
 *
 * Four of the five are the same token twice. The fifth is not: this app calls
 * the shared-feed class `inter_agency` and `MenuOwner` calls it `flock`, and
 * `Menu.tsx` names them as the same thing in its own taxonomy comment -
 * "flock (inter-agency shared)". One rename in either vocabulary and this table
 * is where the mismatch surfaces, which is the reason it is a table and not
 * five inline strings.
 *
 * IT DOES NOT CARRY THE COLOUR. The dot's hue is `--dr-owner-*`, resolved by
 * `menu.css` from the palette, so an operator means the same colour here, on
 * the map and in the dock. Two of them disagree with `layers.ts`'s own
 * `circle-color` today and that is recorded in the stylesheet beside the rule
 * that used to hold the second copy.
 */
const MENU_OWNER: Readonly<Record<CameraOwnerType, MenuOwner>> = Object.freeze({
  police: 'police',
  inter_agency: 'flock',
  hoa: 'hoa',
  private: 'private',
  unverified: 'unverified',
});

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
  /** Open SETTINGS, which is where every appearance control now lives. */
  readonly onOpenTheme: () => void;
  /** Whether the roadwork layer is on. */
  readonly hazards: boolean;
  readonly monitoringVisibleCount?: number | null;
  /** Toggle the roadwork layer. */
  readonly onToggleHazards: () => void;
  /**
   * Whether the layer has a feed where the driver is.
   *
   * `uncovered` is NOT the same as "no roadwork here", and the control has to
   * say which. A blank map in a state with no feed says nothing about the road.
   */
  readonly hazardCoverage: 'covered' | 'uncovered' | 'unknown';
}

export function MapControlPanel({
  open,
  onClose,
  returnFocusTo,
  onOpenTheme,
  hazards,
  monitoringVisibleCount,
  onToggleHazards,
  hazardCoverage,
}: MapControlPanelProps): ReactElement {
  const mapOwnerFilter = useMapOwnerFilter();
  const setMapOwnerFilter = useSettingsStore((s) => s.setMapOwnerFilter);

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

  /** Choosing a class, wherever the press came from. */
  const choose = useCallback(
    (owner: CameraOwnerType | null): void => {
      setMapOwnerFilter(owner);
      // Shut on choosing: the answer is on the map behind this pane, and a
      // driver who has just narrowed it wants to see it.
      closeAndRestore();
    },
    [setMapOwnerFilter, closeAndRestore],
  );

  /** The state of the roadwork layer, in words, which the row prints as well. */
  const hazardState = hazards
    ? hazardCoverage === 'uncovered'
      ? PANEL_HAZARDS_UNCOVERED
      : PANEL_HAZARDS_ON
    : PANEL_HAZARDS_OFF;

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
      <Menu>
        <MenuHeader label={MAP_PANEL_DRAWS} sub={MAP_PANEL_ON_PHONE} />

        {/* FULL SCREEN AND THE MAP ANGLE LEFT THIS PANEL.
            They are settings about how the map BEHAVES, and they now live with
            the rest of those under the MAP VIEW pill - see `MapViewPanel`. They
            moved rather than being duplicated: the same switch in two panels is
            two things to keep in step, and the first time they disagree the
            driver is the one who finds out.

            What is left here is what this panel was always for - what the map
            DRAWS. */}

        {/* SIX ROWS, ONE CHOICE, AND EXACTLY ONE OF THEM IS THE SELECT ROW.
            "One selection, ever" is the menu language's first rule and the
            accent fill is what states it, so the chosen class is drawn as a
            {@link MenuSelect} - a radio, the accent ground, and no press, because
            it is the answer rather than an offer - and the five it is not are
            {@link MenuFilter} rows, which is exactly the arrangement `menu.css`
            section 4 describes for the spec's own panel.

            The row ORDER never moves as the choice does: `All owners` first,
            then `OWNER_TYPES`. A list that re-sorted itself under the thumb
            would make the second press land on something the driver did not
            aim at. */}
        <MenuGroup label={MAP_PANEL_GROUP}>
          {/* ALL OWNERS IS THE ONLY ROW THAT INCLUDES THE UNRECORDED ONES, which
              is most of them: OSM's ALPR nodes rarely carry an `operator`. That
              is why the filter is one nullable choice and not five switches.

              AND IT IS NOT A CLASS, so it must not wear a class's hue. There is
              no `MenuOwner` for "everything" - the language's dot IS the
              taxonomy and "all" is not a taxon - so the row is handed the class
              it happens to sit above and `mapControlPanel.css` redraws that dot
              as a hollow ring. The attribute is the hook; the wrapper carries
              no box of its own. */}
          {mapOwnerFilter === null ? (
            <MenuSelect label={MAP_PANEL_ALL} count={cameras.length} />
          ) : (
            <div className="fwm-drive-panel-all">
              <MenuFilter
                owner="police"
                label={MAP_PANEL_ALL}
                count={cameras.length}
                onPress={() => {
                  choose(null);
                }}
              />
            </div>
          )}

          {/* FIVE ROWS, not the three a first reading of the brief would give.
              `OWNER_TYPES` is five and Look up already offers all five; shipping
              three would leave the map and Look up disagreeing about what an
              owner is, and would leave no way to isolate `unverified`. */}
          {OWNER_TYPES.map((owner) =>
            owner === mapOwnerFilter ? (
              <MenuSelect key={owner} label={OWNER_LABELS[owner]} count={counts.get(owner) ?? 0} />
            ) : (
              <MenuFilter
                key={owner}
                owner={MENU_OWNER[owner]}
                label={OWNER_LABELS[owner]}
                count={counts.get(owner) ?? 0}
                onPress={() => {
                  choose(owner);
                }}
              />
            ),
          )}
        </MenuGroup>

        {/* A ZERO ROW IS SELECTABLE, so the empty result needs saying.
            Pressing a class with no cameras on the phone empties the map, and
            nothing else on screen explains why - the count that would have
            warned you is back inside this panel, which has just closed. */}
        {mapOwnerFilter !== null && (counts.get(mapOwnerFilter) ?? 0) === 0 ? (
          <MenuNote>{MAP_PANEL_EMPTY}</MenuNote>
        ) : null}

        {/* THE BOUNDARY BETWEEN THE FILTERS AND THE SETTINGS UNDER THEM, which
            is the one divider `menu.css` section 9 says the spec's own panel
            draws and this is the panel it draws it in. Above it, six answers to
            one question; below it, two controls that are not that question. */}
        <MenuRule />

        <MonitoringControls visibleCount={monitoringVisibleCount ?? null} />
        <MenuRule />

        {/* ROADWORK, under the filters because it changes what the map draws.
            Off by default and it stays that way - a layer with partial coverage
            that a driver never switched on must never be able to have its
            silence read as a clear road.

            The state is spelled out beside the switch rather than only drawn by
            it: `no feed for this state` and `off - not a police layer` are the
            halves a driver can act on, and the shape alone says neither. */}
        <MenuToggle
          label={PANEL_HAZARDS}
          state={hazardState}
          on={hazards}
          onToggle={() => {
            onToggleHazards();
          }}
        />

        {/* THE WAY OUT TO APPEARANCE, instead of a second copy of it.
            What stood here was six cartography rows, each with a sentence of
            prose, inside a disclosure - most of a small panel spent on a choice
            made once, pushing the owner filter behind a scroll. Every one of
            those rows already exists in SETTINGS beside the palette.

            So this is a door, not a duplicate. It shuts the panel, because the
            answer is on another screen and leaving this open behind it would
            strand a shut panel over the map.

            GAP - THE CHEVRON PROMISES A MENU AND OPENS A SCREEN. `MenuNavigate`
            is documented as opening "a panel of the same kind", and SETTINGS is
            not one. The row is unchanged from what it was and the alternative -
            an action row - is the wrong type twice over: it is the report hue
            and it must be the last row in a panel. Reported rather than
            reworded. */}
        <MenuNavigate
          label={PANEL_THEME}
          value={PANEL_THEME_NOTE}
          onOpen={() => {
            closeAndRestore();
            onOpenTheme();
          }}
        />

        <MenuNote>{MAP_PANEL_DISPLAY_ONLY}</MenuNote>
      </Menu>
    </div>
  );
}
