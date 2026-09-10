/**
 * THE REPORTS MENU - news, documented abuse and the abuse alert settings.
 *
 * =============================================================================
 * WHAT IT REPLACED
 * =============================================================================
 * The Abuse chip opened the MISUSE screen. One press off the map and the driver
 * was on a full-screen archive of ninety-three cases - which is the right screen
 * to READ and the wrong one to reach for while the map is up, because none of it
 * changes what the map or the dock is doing.
 *
 * The Reports chip keeps that popup, with three abuse alert toggles and two
 * explicit destinations: News and Read reports. Reports opens on its Abuse
 * tab with recent reporting, documented cases and EFF Atlas context.
 *
 * =============================================================================
 * IT IS THE MENU LANGUAGE, NOT A SECOND PANEL LANGUAGE
 * =============================================================================
 * Every row here is one of `features/chrome/Menu.tsx`'s six types, and this file
 * hard-codes no geometry and no colour of its own. That language shipped with
 * exactly one consumer - its own test - and this is its first production caller;
 * it was a near-exact fit, which is what a language is for. The three things the
 * abuse cut needs that the default does not have (the thin glass, the red, and a
 * filled toggle row) ride on `MenuTone`, and they are painted in
 * `abuseMenu.css`. See that file for why they are not in `menu.css`.
 *
 * =============================================================================
 * NOT AN OVERLAY, AND FOR THE SAME REASON AS THE LAYERS PANEL
 * =============================================================================
 * A plain positioned block inside DRIVE rather than `openOverlay`. An overlay
 * covers the map, and overlays are saved and re-raised around an alert takeover
 * (`app/screenState.ts`) - so this panel would reappear over the road right
 * after a camera alert, a control the driver did not ask for at the worst moment
 * to be given one. `MapControlPanel.tsx` states the argument in full.
 *
 * =============================================================================
 * IT ADDS NO DOCK STATE AND NO DOCK HEIGHT
 * =============================================================================
 * `Alert on entry` gates the abuse card that `services/alerts/delivery.ts`
 * already posts. The two collapsed dock states it concerns - `abuse-zone` and
 * `abuse-entering` - have been in `features/dock/dockState.ts` since before this
 * switch, are painted red by `dock.css` off `--fwm-dock-edge-abuse`, and are
 * mapped to the `collapsed` pane by `Dock.tsx`. `DOCK_HEIGHT`'s 150 / 170 / 302
 * is untouched and `dockConformance.test.ts` still pins it. If a nineteenth
 * state ever looks necessary here, this file has been misread.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement, RefObject } from 'react';

import {
  Menu,
  MenuHeader,
  MenuNavigate,
  MenuNote,
  MenuRule,
  MenuToggle,
} from '../chrome/Menu.tsx';
import { LOADING } from '../misuse/MisuseScreen.tsx';
import { countyRecords } from '../../services/records/countyRecords.ts';
import type { CountyMisuseRecord } from '../../services/records/countyRecords.ts';
import {
  useAbuseAlertOnEntry,
  useAbuseNameAgency,
  useAbuseNearMe,
  useSettingsStore,
} from '../../stores/index.ts';

import './abuseMenu.css';

/* ------------------------------------------------------------------------ *
 * THE COPY, ALL OF IT, EXPORTED SO A TEST AND THE PANEL READ ONE STRING
 * ------------------------------------------------------------------------ */

/** The group's accessible name. The chip says which panel it opens. */
export const REPORTS_MENU_LABEL = 'Reports';

/** Drawn in tracked caps by the stylesheet, whatever the case here. */
export const REPORTS_HEADER = 'REPORTS';


export const ABUSE_NEAR = 'Abuse near me';
/**
 * GAP - THE SPEC'S OWN VALUE HERE IS NOT COMPUTABLE, AND IT IS NOT INVENTED.
 *
 * The cut draws `1 within 12 mi`. Nothing in this application can produce that
 * pair of numbers. `CountyMisuseRecord` carries a FIPS, an agency, a summary, a
 * count, a year and a citation - no coordinate anywhere - and `CountyLocator`
 * answers a boolean "is this point inside" with no distance to the edge. So
 * there is nothing to measure and nothing to measure it to;
 * `services/alerts/delivery.ts` says the same thing at length above its own
 * `nearby` trigger, which is disabled for exactly this reason.
 *
 * The proxy - read the county off the cameras around the driver and call a
 * record in it nearby - is dead code that reads as a feature: measured on the
 * live archive, 0 of 868 cameras carry `countyFips`. `MisuseScreen.tsx`
 * documents that trap after NEAR ME shipped disabled by it.
 *
 * So this row says what the switch DOES, which is what three of the four value
 * lines in the same cut already say - `on the map`, `sound and haptics`, `in the
 * alert itself` are all meanings and not readings, and this is the fourth in the
 * same register. A number here would have been the one thing on the panel that
 * was not true.
 *
 * WHAT WOULD CLOSE IT: geometry for a documented case - a point or a ring per
 * record - or a decision that the line should read the current county's own
 * count instead, which the data CAN answer.
 */
export const ABUSE_NEAR_VALUE = 'in the nearby count';

export const ABUSE_ALERT = 'Alert on entry';
export const ABUSE_ALERT_VALUE = 'sound and haptics';

export const ABUSE_AGENCY = 'Name the agency';
export const ABUSE_AGENCY_VALUE = 'in the alert itself';

export const REPORTS_NEWS = 'News';
export const REPORTS_NEWS_VALUE = 'ALPR coverage';
export const REPORTS_ABUSE = 'Read reports';

/**
 * THE ONE SENTENCE THAT KEEPS THE LAYER HONEST, and it is not a row.
 *
 * A red area on a map beside a menu full of camera controls reads as "cameras
 * here are worse". It is not that. It is where somebody was caught misusing a
 * system, which may be nowhere near a pole. Twelve pixels of muted prose with no
 * ground and no edge is what makes it read as commentary on the rows rather than
 * as another one - `menu.css` section 9.
 */
export const ABUSE_NOTE =
  'Abuse is recorded per county, not per camera. A case names the agency and the year it happened, ' +
  'not a place on the map. Every one is dated and carries a source you can open.';

/**
 * WHAT A COUNT LOOKS LIKE BEFORE THE FILE HAS LOADED.
 *
 * Not `0`. `countyRecords.ts` rule 2 is that a zero reads as "audited and
 * clean", which is a claim nobody has made, and it applies to the archive's own
 * totals as much as to a county's. An em dash says "not known here", which is
 * the app's idiom for an empty field everywhere else.
 */
export const ABUSE_UNCOUNTED = '—';

/* ------------------------------------------------------------------------ *
 * THE HEADER'S THREE NUMBERS
 * ------------------------------------------------------------------------ */

export interface AbuseCounts {
  /** Rows in the file. Every one is cited; the citation check enforces it. */
  readonly cases: number;
  /** The sum of every row's own `incidents`, which is never an estimate. */
  readonly incidents: number;
  /** Distinct `agency` strings. See {@link abuseCounts}. */
  readonly agencies: number;
}

/**
 * THE THREE NUMBERS THE HEADER PRINTS, COUNTED RATHER THAN QUOTED.
 *
 * The brief says to read them from the data and not to hardcode them, and there
 * is a reason beyond tidiness: `scripts/misuse-patrol.mjs` adds rows, so a
 * literal in this file would be wrong the first time somebody documents a
 * ninety-fourth case, and wrong in the direction of understating it.
 *
 * DISTINCT AGENCY STRINGS, and there is a discrepancy worth stating. The spec's
 * sub-line reads `93 cases - 125 incidents - 41 agencies`. Counted against
 * `public/records/counties.json` at `generatedAt: 2026-09-03`, the first two are
 * exact and the third is not: the file holds 88 distinct agency strings, and no
 * derivation lands on 41 - not distinct counties (84), not states (21), not
 * sources (82), not years (6), and not any normalisation of the agency string,
 * which collapses none of them. So this counts what is there and the 41 is
 * reported rather than reverse-engineered into agreement.
 *
 * NOT NORMALISED, deliberately. "Sacramento County Sheriff" and "Sacramento
 * County Sheriff's Office" would fold together under any reasonable rule, and
 * deciding they are the same agency is a judgement about a named law enforcement
 * body that this function is not entitled to make. Exact strings under-count
 * nothing and over-count only where the source data itself disagrees with
 * itself, which is a data question with a data fix.
 */
export function abuseCounts(records: readonly CountyMisuseRecord[]): AbuseCounts {
  const agencies = new Set<string>();
  let incidents = 0;
  for (const record of records) {
    agencies.add(record.agency);
    incidents += record.incidents;
  }
  return { cases: records.length, incidents, agencies: agencies.size };
}

/**
 * `93 cases - 125 incidents - 41 agencies`, in the spec's own separator.
 *
 * Middle dots, because that is what the cut sets and what every other count line
 * in the product uses. Never pluralised down to "1 case": the file has held more
 * than one since it existed and a singular branch would be untested code on a
 * line nobody can reach.
 */
export function abuseSummary(counts: AbuseCounts): string {
  const { cases, incidents, agencies } = counts;
  return `${String(cases)} cases · ${String(incidents)} incidents · ${String(agencies)} agencies`;
}

/* ------------------------------------------------------------------------ *
 * THE PANEL
 * ------------------------------------------------------------------------ */

export interface AbuseMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * The chip that opened this, so focus can be put back on it.
   *
   * Required rather than optional, exactly as `MapControlPanel` requires it: a
   * panel that goes `inert` while one of its own controls holds focus drops that
   * focus on the floor, and the reader who loses it is the one least able to
   * find their way back. Making it optional would let a caller forget, silently.
   */
  readonly returnFocusTo: RefObject<HTMLButtonElement | null>;
  readonly onReadNews: () => void;
  /** Open the complete abuse view, including recent reporting and Atlas. */
  readonly onReadCases: () => void;
}

export function AbuseMenu({
  open,
  onClose,
  returnFocusTo,
  onReadNews,
  onReadCases,
}: AbuseMenuProps): ReactElement {
  /*
   * THE FOUR FLAGS, READ STRAIGHT FROM THE REGISTRY.
   *
   * `stores/settings.ts` IS the layer registry - it is what the Layers menu
   * writes (`mapOwnerFilter`, `showHazards`) and there is no other. `layers.ts`
   * is pure layer-spec builders and `mapRegistry.ts` is an instance handle;
   * neither holds state. So these are not props: the panel that owns the
   * controls reads the store that owns the answers, which is the arrangement
   * `MapControlPanel` already uses for the owner filter.
   *
   * Four selectors rather than one object, so flipping the agency name does not
   * re-render a component watching the layer.
   */
  const nearMe = useAbuseNearMe();
  const alertOnEntry = useAbuseAlertOnEntry();
  const nameAgency = useAbuseNameAgency();
  const setAbuseNearMe = useSettingsStore((s) => s.setAbuseNearMe);
  const setAbuseAlertOnEntry = useSettingsStore((s) => s.setAbuseAlertOnEntry);
  const setAbuseNameAgency = useSettingsStore((s) => s.setAbuseNameAgency);

  /*
   * THE RECORD FILE, ON THE IDIOM THAT ALREADY EXISTS.
   *
   * `countyRecords` loads on demand and publishes nothing - there is no
   * subscription to take. `MisuseScreen.tsx` polls `ready()` at 250ms and reads
   * once, and this does the same rather than adding a second poller: two timers
   * a quarter-second apart mean two re-renders, which on a header of counts
   * reads as the numbers correcting themselves. A count that visibly changes
   * after a reader has accepted it is worse than one that arrives late.
   */
  const [records, setRecords] = useState<readonly CountyMisuseRecord[]>(() =>
    countyRecords.all(),
  );
  useEffect(() => {
    if (countyRecords.ready()) {
      setRecords(countyRecords.all());
      return undefined;
    }
    let live = true;
    const timer = globalThis.setInterval(() => {
      if (!countyRecords.ready()) return;
      if (live) setRecords(countyRecords.all());
      globalThis.clearInterval(timer);
    }, 250);
    return () => {
      live = false;
      globalThis.clearInterval(timer);
    };
  }, []);

  const counts = useMemo(() => abuseCounts(records), [records]);
  const loaded = counts.cases > 0;

  /**
   * CLOSING PUTS FOCUS BACK ON THE CHIP THAT OPENED IT.
   *
   * The row that shuts the panel does it from inside its own click handler and
   * the container takes `inert` in the same commit, so the control that had
   * focus stops being focusable and focus falls to `<body>`. Escape does the
   * same. Wrapped so every caller goes through it - the copy of this note in
   * `MapControlPanel.closeAndRestore` is where the defect was first found.
   */
  const closeAndRestore = useCallback((): void => {
    onClose();
    returnFocusTo.current?.focus();
  }, [onClose, returnFocusTo]);

  /*
   * ESCAPE SHUTS IT. There is no scrim to tap - a scrim is a thing covering the
   * map - so the keyboard needs a way out that is not hunting for the chip that
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
      className="fwm-drive-abuse"
      role="group"
      aria-label={REPORTS_MENU_LABEL}
      data-fwm-open={String(open)}
      /* CSS hides it with `visibility`, which is enough in a browser. These two
         are for everything that does not run the stylesheet - the test
         environment among them - so a shut panel is never a set of controls a
         reader or a tab key can reach. */
      aria-hidden={!open}
      inert={!open}
    >
      <Menu tone="abuse">
        <MenuHeader label={REPORTS_HEADER} sub={loaded ? `Abuse: ${abuseSummary(counts)}` : LOADING} />

        <MenuToggle
          label={ABUSE_NEAR}
          state={ABUSE_NEAR_VALUE}
          on={nearMe}
          onToggle={setAbuseNearMe}
        />

        {/* THE ONE SWITCH ON THIS PANEL THAT CHANGES WHAT THE DRIVER IS TOLD.
            Off by default, which turns an alert that fires today off for every
            existing install until somebody opts in - see `abuseAlertOnEntry` in
            `stores/settings.ts` for why that is the brief's instruction and not
            an accident. */}
        <MenuToggle
          label={ABUSE_ALERT}
          state={ABUSE_ALERT_VALUE}
          on={alertOnEntry}
          onToggle={setAbuseAlertOnEntry}
        />

        <MenuToggle
          label={ABUSE_AGENCY}
          state={ABUSE_AGENCY_VALUE}
          on={nameAgency}
          onToggle={setAbuseNameAgency}
        />

        <MenuRule />

        <MenuNavigate
          label={REPORTS_NEWS}
          value={REPORTS_NEWS_VALUE}
          onOpen={() => {
            closeAndRestore();
            onReadNews();
          }}
        />

        {/* THE ARCHIVE, AS THE LAST ROW RATHER THAN THE WHOLE CONTENT.
            It shuts the panel first: the answer is on another screen, and
            leaving this open behind it would strand a shut panel over the map. */}
        <MenuNavigate
          label={REPORTS_ABUSE}
          value={loaded ? `${String(counts.cases)} documented` : ABUSE_UNCOUNTED}
          onOpen={() => {
            closeAndRestore();
            onReadCases();
          }}
        />

        <MenuNote>{ABUSE_NOTE}</MenuNote>
      </Menu>
    </div>
  );
}
