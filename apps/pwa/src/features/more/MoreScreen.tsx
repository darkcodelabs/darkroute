/**
 * MORE - seven rows in four groups.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section C, frame 1. Brief 4:
 * "Was five tiles plus three cards. Groups: ACCOUNTABILITY (Misuse, Report
 * abuse) - ALERTS (Alert diet, Hands free) - THIS PHONE (What it knows,
 * Settings) - ABOUT (How this works)."
 *
 * =============================================================================
 * THREE THINGS ARE DELETED RATHER THAN RESTYLED, AND THAT IS THE POINT
 * =============================================================================
 * The brief names all three and gives the reason for each:
 *
 *   THE LIGHT/DARK CARD. Theme is in the map rail AND in Settings. This was a
 *   third place to change one setting, which is two too many - and the one a
 *   driver would find last, since a hub is where you go when you already know
 *   what you want. `ThemeDemo` and its five exported strings are gone, and
 *   `ThemeDemo.test.tsx` went with them: seven cases about a component that no
 *   longer exists are not coverage, they are a file that has to be deleted
 *   later by somebody with less context.
 *
 *   THE INSTALL PROMPT. Same argument, and it belongs in Settings, which is
 *   where brief 4's own SETTINGS frame draws `Install on this phone`. The card
 *   had five states, a browser-refusal table and two effects behind it; all of
 *   that leaves with it, including `installController`, `hasInstalledRelatedApp`
 *   and the `INSTALL_*` copy.
 *
 *   `Find a camera`. That is the Lookup tab. The dock lights LOOKUP with its
 *   own key, so this tile was a second door to a room the driver is standing
 *   next to.
 *
 * =============================================================================
 * EVERY META IS READ, AND SILENCE IS AN ANSWER
 * =============================================================================
 * The spec draws "93 documented cases" and "5 owner types on". Those are its
 * placeholders; neither ships. Each row either reports a live count or says the
 * constant the spec wrote. The one number that can be absent - the misuse count
 * before the record index has loaded - prints NOTHING rather than a zero: "0
 * documented cases" is a claim about American policing this app has not earned,
 * and a hub whose subtitles are fiction teaches a driver to distrust every
 * number in the product.
 *
 * =============================================================================
 * REPORT ABUSE IS A SHEET, NOT A SCREEN
 * =============================================================================
 * The one new row. It calls `openReportSheet()` rather than
 * `openScreen('report')`, because `features/report/ReportScreen.tsx` states in
 * its own header that the sheet has exactly one entry point and the dock's
 * report key already binds to it. A second door into a surface that holds an
 * unsent draft is how a draft gets orphaned.
 *
 * =============================================================================
 * NO BACK KEY, AND THAT IS THE DECISION RATHER THAN AN OMISSION
 * =============================================================================
 * MORE is a dock tab. `components/nav/backAffordance.source.test.ts` asserts
 * that no dock root draws one, with the argument written beside it: "the only
 * parent a root has is itself", and an arrow that navigates to the screen you
 * are already looking at is not a way out. The way off MORE is the dock, four
 * keys of it, all going somewhere else.
 *
 * The spec draws a 40px exit circle at the head of this title row. It is NOT
 * shipped here and that is an open question rather than a refusal - see the
 * handover notes. Shipping it would put a control on five tab roots that the
 * source test forbids, at 40px against the product's 44px touch minimum, on a
 * shared component that carries a `backdrop-filter` this section bans.
 */

import type { ReactElement } from 'react';

import { openScreen } from '../../app/screenState.ts';
import type { ScreenId } from '../../app/screenState.ts';
import { countyRecords } from '../../services/records/countyRecords.ts';
import { useOwnerTypesEnabled } from '../../stores/index.ts';
import { useAdmin } from '../admin/useAdmin.ts';
import { openReportSheet } from '../report';
import { ReloadTitle } from '../../components/nav';
import { ScreenChevron } from '../../components/screen';

import '../../styles/screen.css';
import './more.css';

export const MORE_TITLE = 'More';

/** The four group headers, in the spec's order, with the spec's own hues. */
export const GROUP_ACCOUNTABILITY = 'ACCOUNTABILITY';
export const GROUP_ALERTS = 'ALERTS';
export const GROUP_THIS_PHONE = 'THIS PHONE';
export const GROUP_ABOUT = 'ABOUT';

/**
 * The closing note, verbatim off the spec's own frame.
 *
 * It is here because a driver who used to change the theme on this screen has
 * to be told where it went; a hub that silently loses a destination reads as a
 * broken hub. The third sentence is the product saying why, which is the voice
 * every other absence in this app is written in.
 */
export const MORE_NOTE =
  'Theme is in the map rail and in Settings. Find a camera is the Lookup tab. ' +
  'Neither needs a third home here.';

/** A meta line with no number to report says nothing rather than guessing. */
const SILENT = '';

/** The four hues the spec's own `moreGroups` block assigns to the headers. */
type GroupHue = 'red' | 'amber' | 'cyan' | 'muted';

interface Row {
  readonly title: string;
  readonly meta: string;
  /** What pressing it does. A screen id, or the report sheet. */
  readonly go: ScreenId | 'report-sheet';
}

interface Group {
  readonly label: string;
  readonly hue: GroupHue;
  readonly rows: readonly Row[];
}

export function MoreScreen(): ReactElement {
  const owners = useOwnerTypesEnabled();
  const identity = useAdmin();

  /** How many owner types are still switched on, which is what ALERT DIET sets. */
  const ownersOn = Object.values(owners).filter(Boolean).length;

  /**
   * How many documented cases are on file.
   *
   * Read straight off the record index rather than held in state: the file
   * loads once and the number never changes afterwards, so a subscription
   * would be machinery for a constant.
   */
  const misuseCount = countyRecords.all().length;

  const about: Row[] = [
    { title: 'How this works', meta: 'docs, data, this build', go: 'docs' },
  ];

  /*
   * ADMIN IS NOT A ROW EVERYBODY SEES, AND IT SURVIVES THE REFACTOR.
   *
   * The spec's four groups have no Admin row, because the spec draws the screen
   * every visitor gets and this row is not in it. It is kept, gated, at the
   * foot of ABOUT: `MoreScreen.test.tsx` holds three cases on it and they are
   * not styling tests, they are the check that a moderator surface is not
   * advertised to strangers. `AdminLink.tsx` had the rule and this list did not,
   * which is how the row once shipped to everybody reading "needs an access
   * identity" - an invitation to go and rattle it.
   *
   * It also settles the two-host question without any hostname logic. The
   * public domain carries no `Cf-Access-Jwt-Assertion` header, `verifyAccess`
   * returns null, `isAdmin` is false, and the row simply is not there.
   */
  if (identity.admin) {
    about.push({ title: 'Admin', meta: 'moderator tools', go: 'admin' });
  }

  const groups: readonly Group[] = [
    {
      label: GROUP_ACCOUNTABILITY,
      hue: 'red',
      rows: [
        {
          title: 'Reports',
          // NOTHING until the file is loaded. See the header.
          meta: misuseCount === 0 ? SILENT : `${String(misuseCount)} documented cases`,
          go: 'reports',
        },
        { title: 'Report abuse', meta: 'with a source', go: 'report-sheet' },
        { title: 'News', meta: 'ALPR reporting, updated automatically', go: 'news' },
      ],
    },
    {
      label: GROUP_ALERTS,
      hue: 'amber',
      rows: [
        { title: 'Alert diet', meta: `${String(ownersOn)} owner types on`, go: 'triage' },
        { title: 'Hands free', meta: 'spoken, matched on the phone', go: 'ask' },
      ],
    },
    {
      label: GROUP_THIS_PHONE,
      hue: 'cyan',
      rows: [
        { title: 'What it knows', meta: 'answers with file paths', go: 'help' },
        { title: 'Settings', meta: 'permissions, theme, wipe', go: 'settings' },
      ],
    },
    { label: GROUP_ABOUT, hue: 'muted', rows: about },
  ];

  return (
    <section className="fwm-screen fwm-more" aria-label="more">
      <div className="fwm-screen-title">
        <ReloadTitle title={MORE_TITLE} className="fwm-screen-title-text" />
      </div>

      <div className="fwm-screen-band fwm-more-band">
        {groups.map((group) => (
          <section className="fwm-more-group" key={group.label} aria-label={group.label}>
            <div className="fwm-screen-group">
              <h2 className="fwm-screen-group-label" data-fwm-hue={group.hue}>
                {group.label}
              </h2>
            </div>
            <div className="fwm-screen-stack" data-fwm-gap="rows">
              {group.rows.map((row) => (
                <button
                  type="button"
                  key={row.title}
                  className="fwm-screen-row"
                  onClick={() => {
                    if (row.go === 'report-sheet') openReportSheet();
                    else openScreen(row.go);
                  }}
                >
                  <span className="fwm-screen-row-title">{row.title}</span>
                  {/* The meta is always rendered, even when it is silent: it is
                      the flex spacer that pushes the chevron to the tail, and a
                      row whose chevron slides left when a count is missing
                      reads as a different kind of row. */}
                  <span className="fwm-screen-row-meta fwm-data">{row.meta}</span>
                  <ScreenChevron />
                </button>
              ))}
            </div>
          </section>
        ))}

        <p className="fwm-screen-note fwm-more-note">{MORE_NOTE}</p>
      </div>

      <div className="fwm-screen-dock-reserve" aria-hidden="true" />
    </section>
  );
}
