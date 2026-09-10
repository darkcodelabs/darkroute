/**
 * THE REPORTS MENU'S BEHAVIOUR, WHICH IS THE HALF THE SPEC DOES NOT DRAW.
 *
 * The markup is `features/chrome/Menu.tsx`'s and `Menu.test.tsx` already
 * measures it - the 44px row, the 40x23 switch, the header's 0.14em, the one
 * accent fill. Repeating any of that here would be a second copy of a
 * measurement, and the second copy is the one that goes stale. So this file
 * checks only what this panel decides:
 *
 *   1. THE THREE NUMBERS IN THE HEADER ARE COUNTED, not quoted. The brief says
 *      to read them from the data, and a literal would be wrong the first time
 *      `misuse-patrol.mjs` documents a ninety-fourth case.
 *   2. A ZERO IS NEVER PRINTED. `countyRecords.ts` rule 2: a zero reads as
 *      "audited and clean", which is a claim nobody has made. Before the file
 *      loads the header says it is loading and the archive row says nothing.
 *   3. THE SEVEN ROWS ARE THESE SEVEN, IN THIS ORDER, and the fill is on
 *      exactly one of them.
 *   4. EVERY TOGGLE WRITES THE REGISTRY - `stores/settings.ts`, which is what
 *      the Layers menu writes and the only place layer state lives.
 *   5. A SHUT PANEL IS UNREACHABLE, and closing hands focus back.
 *
 * News opens ALPR coverage; Abuse opens the complete abuse view. Both close the menu.
 */

import { readFileSync } from 'node:fs';

import { createRef } from 'react';
import type { ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING } from '../misuse/MisuseScreen.tsx';
import { countyRecords } from '../../services/records/countyRecords.ts';
import type { CountyMisuseRecord } from '../../services/records/countyRecords.ts';
import { resetAllStores, useSettingsStore } from '../../stores/index.ts';

import {
  ABUSE_AGENCY,
  ABUSE_ALERT,
  REPORTS_HEADER,
  REPORTS_MENU_LABEL,
  ABUSE_NEAR,
  ABUSE_NOTE,
  REPORTS_NEWS,
  REPORTS_ABUSE,
  ABUSE_UNCOUNTED,
  AbuseMenu,
  abuseCounts,
  abuseSummary,
} from './AbuseMenu.tsx';

/* ------------------------------------------------------------------------ *
 * A RECORD FILE, SHAPED LIKE THE REAL ONE
 * ------------------------------------------------------------------------ */

function record(over: Partial<CountyMisuseRecord> = {}): CountyMisuseRecord {
  return {
    fips: '29095',
    agency: 'Kansas City Police Department',
    summary: 'an officer ran plates for a personal reason.',
    incidents: 1,
    year: 2024,
    sourceUrl: 'https://example.org/a',
    sourceName: 'Example Newsroom',
    ...over,
  };
}

/**
 * THE INDEX IS A MODULE SINGLETON WITH NO SUBSCRIPTION AND NO SETTER, so this
 * is the only way to put a known file in front of the panel. Spying on the two
 * methods it reads is narrower than replacing the module: the poll loop, the
 * readiness check and the memo are all still the real ones.
 */
function haveRecords(records: readonly CountyMisuseRecord[], ready = true): void {
  vi.spyOn(countyRecords, 'all').mockReturnValue(records);
  vi.spyOn(countyRecords, 'ready').mockReturnValue(ready);
}

function Harness({ open = true }: { readonly open?: boolean }): ReactElement {
  return (
    <AbuseMenu
      open={open}
      onClose={() => undefined}
      returnFocusTo={createRef<HTMLButtonElement>()}
      onReadNews={() => undefined}
      onReadCases={() => undefined}
    />
  );
}

/** The switch, addressed the way a screen reader addresses it. */
function switchFor(label: string): HTMLElement {
  return screen.getByRole('switch', { name: label });
}

beforeEach(() => {
  resetAllStores();
});

/* ------------------------------------------------------------------------ *
 * THE HEADER'S THREE NUMBERS
 * ------------------------------------------------------------------------ */

describe('the counts, read from the data', () => {
  it('counts cases, sums incidents and counts distinct agencies', () => {
    const counts = abuseCounts([
      record({ agency: 'A', incidents: 2 }),
      record({ agency: 'B', incidents: 3 }),
      record({ agency: 'A', incidents: 1, fips: '20091' }),
    ]);
    expect(counts).toEqual({ cases: 3, incidents: 6, agencies: 2 });
  });

  /**
   * INCIDENTS IS A SUM, NOT A ROW COUNT. `CountyMisuseRecord.incidents` is what
   * the source says one entry represents, and the two numbers are different on
   * the live file - 93 cases carrying 125 incidents between them.
   */
  it('never mistakes the number of cases for the number of incidents', () => {
    const counts = abuseCounts([record({ incidents: 7 })]);
    expect(counts.cases).toBe(1);
    expect(counts.incidents).toBe(7);
  });

  /**
   * NOT NORMALISED, and that is a refusal rather than an oversight. Deciding
   * that two spellings name one law enforcement agency is a judgement about a
   * named public body, and this function is not entitled to make it.
   */
  it('treats two spellings of one agency as two, and says so by counting them', () => {
    const counts = abuseCounts([
      record({ agency: 'Sacramento County Sheriff' }),
      record({ agency: "Sacramento County Sheriff's Office" }),
    ]);
    expect(counts.agencies).toBe(2);
  });

  it('sets the sub-line in the spec’s own separator', () => {
    expect(abuseSummary({ cases: 93, incidents: 125, agencies: 88 })).toBe(
      '93 cases · 125 incidents · 88 agencies',
    );
  });

  it('empties to zeroes rather than throwing on a file that has not loaded', () => {
    expect(abuseCounts([])).toEqual({ cases: 0, incidents: 0, agencies: 0 });
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT THE PANEL DRAWS
 * ------------------------------------------------------------------------ */

describe('the panel', () => {
  it('labels the totals as abuse under the Reports header', () => {
    haveRecords([
      record({ agency: 'A', incidents: 2 }),
      record({ agency: 'B', incidents: 3 }),
    ]);
    render(<Harness />);
    expect(screen.getByText(REPORTS_HEADER)).toBeInTheDocument();
    expect(screen.getByText('Abuse: 2 cases · 5 incidents · 2 agencies')).toBeInTheDocument();
  });

  /**
   * A ZERO READS AS "AUDITED AND CLEAN", WHICH IS A CLAIM NOBODY HAS MADE.
   * `countyRecords.ts` states the rule for a county's strip and it is the same
   * rule for the archive's own totals: before the file has loaded the header
   * says it is being read, and the archive row shows an em dash rather than a
   * count of nothing.
   */
  it('says the file is loading rather than printing a zero', () => {
    haveRecords([], false);
    render(<Harness />);
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(/0 cases/u)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Read reports/u })).toHaveTextContent(
    ABUSE_UNCOUNTED,
    );
  });

  /**
   * SEVEN ROWS, IN THE SPEC'S ORDER, and the order is the design: four toggles
   * that change the map and the alert, a rule, then the two that navigate. A
   * navigate row above a toggle would make the panel read as a list of places
   * to go rather than a set of switches.
   */
  it('draws the five rows in the spec’s order, with the archive last', () => {
    haveRecords([record()]);
    const { container } = render(<Harness />);
    const rows = [...container.querySelectorAll('.fwm-menu-row')];
    /* FIVE. The brief draws seven; the divider is not a row (menu.css section 9
       says why - it is the visible edge of "rows never mix types inside a
       group"), and `Show abuse areas` was REMOVED by owner decision because a
       documented case carries a FIPS and no coordinate, so the row promised a
       map object that cannot exist. */
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(ABUSE_NEAR),
      expect.stringContaining(ABUSE_ALERT),
      expect.stringContaining(ABUSE_AGENCY),
      expect.stringContaining(REPORTS_NEWS),
      expect.stringContaining(REPORTS_ABUSE),
    ]);
    // THE THREE TOGGLES ARE TOGGLES AND THE TWO NAVIGATES ARE NOT. A toggle
    // drawn as a navigate row would be a switch a driver cannot press.
    expect(rows.slice(0, 3).map((row) => row.getAttribute('data-fwm-row'))).toEqual([
      'toggle',
      'toggle',
      'toggle',
    ]);
    expect(rows.slice(3).map((row) => row.getAttribute('data-fwm-row'))).toEqual([
      'navigate',
      'navigate',
    ]);
    // The divider falls between the switches and the two that navigate.
    expect(container.querySelector('.fwm-menu-rule')).toBeInTheDocument();
  });

  /**
   * ONE FILL, EVER. The language's rule survives the tone change: the hue
   * moved from cyan to red, it did not multiply. Two filled rows and the panel
   * has stopped saying anything.
   */
  it('fills no row, because the row that was filled is gone', () => {
    /* The accent fill existed for `Show abuse areas` - the one row the panel
       was about. With that row removed by owner decision there is no subject to
       promote, and filling one of the five survivors would be picking a
       favourite the brief never named. `MenuToggle.filled` stays in the menu
       language with its own test; it simply has no consumer here. */
    haveRecords([record()]);
    const { container } = render(<Harness />);
    expect([...container.querySelectorAll('[data-fwm-filled="true"]')]).toHaveLength(0);
  });

  it('wears the abuse tone, which is what paints it red on the thin glass', () => {
    haveRecords([record()]);
    const { container } = render(<Harness />);
    expect(container.querySelector('.fwm-menu')).toHaveAttribute('data-fwm-tone', 'abuse');
  });

  /**
   * THE NOTE IS NOT A ROW, and having no ground and no edge is what makes it
   * read as commentary on the rows rather than as another one.
   */
  it('closes with the note that an abuse area is not a camera', () => {
    haveRecords([record()]);
    const { container } = render(<Harness />);
    const note = container.querySelector('.fwm-menu-note');
    expect(note).toHaveTextContent(ABUSE_NOTE);
    expect(note?.classList.contains('fwm-menu-row')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * THE REGISTRY
 * ------------------------------------------------------------------------ */

describe('the toggles, against the layer registry', () => {
  /**
   * `stores/settings.ts` IS the registry - it is what `MapControlPanel` and
   * DRIVE write for the owner filter and the roadwork layer, and there is no
   * second one. A panel that held its own copy of "is the abuse layer on"
   * would be the first step to two surfaces disagreeing about the map.
   */
  it('draws each switch from the store it writes', () => {
    haveRecords([record()]);
    render(<Harness />);
    // The three the spec draws ON, and the one it draws OFF.
    expect(switchFor(ABUSE_NEAR)).toHaveAttribute('aria-checked', 'true');
    expect(switchFor(ABUSE_AGENCY)).toHaveAttribute('aria-checked', 'true');
    expect(switchFor(ABUSE_ALERT)).toHaveAttribute('aria-checked', 'false');
  });


  it('writes abuseNearMe, abuseAlertOnEntry and abuseNameAgency from their own rows', () => {
    haveRecords([record()]);
    render(<Harness />);
    fireEvent.click(switchFor(ABUSE_NEAR));
    fireEvent.click(switchFor(ABUSE_ALERT));
    fireEvent.click(switchFor(ABUSE_AGENCY));
    const state = useSettingsStore.getState();
    expect(state.abuseNearMe).toBe(false);
    expect(state.abuseAlertOnEntry).toBe(true);
    expect(state.abuseNameAgency).toBe(false);
  });

  /**
   * ONE ROW, ONE FLAG. Four switches sharing a slice would mean pressing one
   * moved another, which is the defect that is invisible until somebody turns
   * off the alert and finds the layer gone with it.
   */
  it('leaves the other three alone when one is pressed', () => {
    haveRecords([record()]);
    render(<Harness />);
    fireEvent.click(switchFor(ABUSE_AGENCY));
    const state = useSettingsStore.getState();
    expect(state.abuseNearMe).toBe(true);
    expect(state.abuseAlertOnEntry).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * THE TWO NAVIGATE ROWS
 * ------------------------------------------------------------------------ */

describe('the report destinations', () => {
  it('opens the abuse view, displays its documented count, and closes the menu', () => {
    haveRecords([record(), record({ fips: '20091' })]);
    const onReadNews = vi.fn();
    const onReadCases = vi.fn();
    const onClose = vi.fn();
    render(
      <AbuseMenu
        open
        onClose={onClose}
        returnFocusTo={createRef<HTMLButtonElement>()}
        onReadNews={onReadNews}
        onReadCases={onReadCases}
      />,
    );
    const row = screen.getByRole('button', { name: /^Read reports/u });
    expect(row).toHaveTextContent('2 documented');
    fireEvent.click(row);
    expect(onReadCases).toHaveBeenCalledExactlyOnceWith();
    expect(onReadNews).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens news independently from documented cases and closes the menu', () => {
    haveRecords([], false);
    const onReadNews = vi.fn();
    const onReadCases = vi.fn();
    const onClose = vi.fn();
    render(
      <AbuseMenu
        open
        onClose={onClose}
        returnFocusTo={createRef<HTMLButtonElement>()}
        onReadNews={onReadNews}
        onReadCases={onReadCases}
      />,
    );
    const row = screen.getByRole('button', { name: /^News/u });
    expect(row).toHaveTextContent('ALPR coverage');
    expect(row).toBeEnabled();
    fireEvent.click(row);
    expect(onReadNews).toHaveBeenCalledExactlyOnceWith();
    expect(onReadCases).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------ *
 * SHUT
 * ------------------------------------------------------------------------ */

describe('the shut panel', () => {
  /**
   * THE STYLESHEET HIDES IT WITH `visibility`, WHICH THIS ENVIRONMENT DOES NOT
   * RUN. `aria-hidden` and `inert` are what make a shut panel unreachable for
   * a screen reader and a tab key regardless, and they are the half a test can
   * see. `MapViewPanel.test.tsx` guards the same contract for the same reason.
   */
  it('stays mounted, says it is shut, and is unreachable while it is', () => {
    haveRecords([record()]);
    const { container } = render(<Harness open={false} />);
    const panel = container.querySelector('.fwm-drive-abuse');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-fwm-open', 'false');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
  });

  it('carries the open flag the stylesheet reads when it is up', () => {
    haveRecords([record()]);
    const { container } = render(<Harness />);
    expect(container.querySelector('.fwm-drive-abuse')).toHaveAttribute(
      'data-fwm-open',
      'true',
    );
  });

  it('names itself for a reader that cannot see which panel opened', () => {
    haveRecords([record()]);
    expect(render(<Harness />).container.querySelector('.fwm-drive-abuse')).toHaveAttribute(
      'aria-label',
      REPORTS_MENU_LABEL,
    );
  });

  /**
   * ESCAPE SHUTS IT AND HANDS FOCUS BACK. There is no scrim to tap, so the
   * keyboard needs a way out that is not hunting for the chip that opened it -
   * and without the hand-back, focus falls to `<body>` the moment the panel
   * takes `inert`.
   */
  it('shuts on Escape and returns focus to the chip that opened it', () => {
    haveRecords([record()]);
    const chip = document.createElement('button');
    document.body.appendChild(chip);
    const ref = { current: chip };
    const onClose = vi.fn();
    render(
      <AbuseMenu
        open
        onClose={onClose}
        returnFocusTo={ref}
        onReadNews={() => undefined}
        onReadCases={() => undefined}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(chip);
    chip.remove();
  });

  it('ignores Escape while it is already shut', () => {

    haveRecords([record()]);
    const onClose = vi.fn();
    render(
      <AbuseMenu
        open={false}
        onClose={onClose}
        returnFocusTo={createRef<HTMLButtonElement>()}
        onReadNews={() => undefined}
        onReadCases={() => undefined}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * THE STYLESHEET, WHICH FAILS SILENTLY IF IT BREAKS
 * ------------------------------------------------------------------------ */

/**
 * WHY THIS IS READ OFF DISK RATHER THAN ASSERTED THROUGH THE DOM.
 *
 * Two reasons, both of them `Menu.test.tsx`'s: vitest runs with `css: false`,
 * which stubs every stylesheet import - `?raw` included - to the empty string,
 * so an assertion against an import would pass on '' whatever the file said;
 * and jsdom does not cascade custom properties, so a computed colour here is ''.
 *
 * WHAT IT GUARDS is the two joins that break without a sound. The tone is a
 * component writing an attribute and a stylesheet in a different feature
 * reading it - rename either end and the panel silently loses its hue and its
 * glass while every rendered test still passes. And `--dr-*` is NOT checked by
 * `scripts/check-design-values.mjs`, which validates only that a `--fwm-*`
 * reference names something: a misspelt `--dr-abuse` is not a violation, it is
 * a declaration the browser drops, and the row draws with no fill at all.
 */
describe('abuseMenu.css, read as a file', () => {
  const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
  /** Comments blanked, so prose quoting a selector is not read as one. */
  const blank = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//gu, (chunk) => chunk.replace(/[^\n]/gu, ' '));
  const CSS = blank(readFileSync(`${HERE}/abuseMenu.css`, 'utf8'));
  const TOKENS = blank(readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'));

  it('keys every tone rule off the attribute the component actually writes', () => {
    expect(CSS).toMatch(/\.fwm-menu\[data-fwm-tone='abuse'\]/u);
    expect(CSS).toMatch(/\[data-fwm-filled='true'\]/u);
    // And nothing else in the app reaches for the tone, which is what keeps
    // this variant the abuse menu's rather than a second menu language.
    expect(CSS.match(/data-fwm-tone='abuse'/gu) ?? []).toHaveLength(6);
  });

  it('draws the thin glass and its grain, not the menu language’s denser surface', () => {
    expect(CSS).toMatch(/background:\s*var\(--dr-grain\),\s*var\(--dr-surface-thin\)/u);
    expect(CSS).not.toMatch(/--dr-surface-menu/u);
  });

  /**
   * EVERY COLOUR IT NAMES HAS TO EXIST IN ALL FOUR PLACES `--dr-*` IS CUT:
   * the dark `:root` and the three light skins. A token declared in dark only
   * is a rule that paints nothing on `refinement`, `e-ink` and `paper`, which
   * is a blank row on precisely the skins somebody reads in daylight.
   */
  it('names only --dr-* colours that are declared in dark and in all three light skins', () => {
    const named = [...new Set([...CSS.matchAll(/var\((--dr-[a-z0-9-]+)\)/gu)].map((m) => m[1]))];
    expect(named.length).toBeGreaterThan(0);
    for (const token of named) {
      // 1 dark root + 3 light skins. `--dr-grain` and `--dr-lift` are cut in
      // fewer places on purpose - they are inherited from the dark root where a
      // skin does not restate them - so the floor is "declared at all", and the
      // four the abuse tone introduced are held to the full four.
      expect(CSS.includes(`var(${token})`)).toBe(true);
      expect(TOKENS).toMatch(new RegExp(`${token}\\s*:`, 'u'));
    }
    for (const token of ['--dr-abuse', '--dr-abuse-text', '--dr-abuse-fill', '--dr-abuse-line']) {
      expect(TOKENS.match(new RegExp(`${token}\\s*:`, 'gu')) ?? []).toHaveLength(4);
    }
  });

  /**
   * THE GATE REJECTS `:hover` OUTRIGHT, and the spec cut carries `style-hover`
   * on both navigate rows. Dropped rather than translated, exactly as
   * `menu.css`, `dock.css` and `topBar.css` dropped theirs - inventing an
   * `:active` in its place would be adding a state the design does not draw.
   */
  it('states no hover', () => {
    expect(CSS).not.toMatch(/:hover/u);
  });
});
