/**
 * `05 · LOG - EXPOSURE`, rendered from a view model, against what the design
 * draws.
 *
 * Reference: `.design-src-v2/Flockys App Screens v2.dc.html`, panel
 * `05 · LOG - EXPOSURE` -- the redesign, and where it disagrees with anything
 * older it wins. `Flockys Watch.dc.html`, `W5 · TODAY - EXPOSURE GLANCE` for
 * the seven-day trend; `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE` for
 * the muting rule.
 *
 * v2 changed no string on this panel, so every copy assertion below is
 * unchanged and still passes against v2. `the v2 redesign` at the bottom of
 * this file is the whole of the delta: six visual moves, each asserted against
 * the token it now names and against the v1 token it must no longer name.
 *
 * `log.css` is READ FROM DISK, not imported. vitest runs with `css: false`,
 * which stubs every CSS import -- `?raw` included -- to an empty string, so an
 * assertion against the import would pass on '' no matter what the file says.
 */

// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NO_VALUE } from '../../radar';
import { localDayStart, sevenDayBars } from '../exposure.ts';

import { LogView, emptyTimelineMessage } from './LogView.tsx';
import type { LogViewModel } from './LogView.tsx';
import type { LogRow } from './Timeline.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const logCss: string = readFileSync(`${HERE}/../log.css`, 'utf8');
/** Rules only. The file's prose explains why there is no hover state, using the word. */
const logRules: string = logCss.replace(/\/\*[\s\S]*?\*\//g, '');

const MOMENT = new Date(2026, 2, 4, 14, 22, 8).getTime();

/** The three rows the panel draws, in the order it draws them. */
const ROWS: readonly LogRow[] = [
  {
    id: 1,
    name: 'Vine St & 7th',
    meta: '14:22:08 · 47 MPH · 380 FT',
    state: 'in_range',
    outcome: 'confirmed',
    muted: false,
  },
  {
    id: 2,
    name: 'Reading Rd',
    meta: '14:09:51 · 38 MPH · 760 FT',
    state: 'approaching',
    outcome: 'dismissed',
    muted: false,
  },
  {
    id: 3,
    name: 'I-71 N Exit 3',
    meta: '13:58:12 · 62 MPH · 210 FT',
    state: 'in_range',
    outcome: 'confirmed',
    muted: false,
  },
];

function model(over: Partial<LogViewModel> = {}): LogViewModel {
  return {
    scope: 'trip',
    todayPasses: 12,
    todayUnique: 4,
    bars: sevenDayBars([], MOMENT),
    segment: { name: 'Reading Rd', cameraCount: 5, passes: 9 },
    allTimePasses: 1284,
    allTimeSinceMs: new Date(2026, 2, 1).getTime(),
    rows: ROWS,
    tripOpen: true,
    ...over,
  };
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.fwm-log');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.[\]"=]/g, (c) => `\\${c}`);
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(logCss);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

describe('header', () => {
  it('titles the screen EXPOSURE and offers the two scopes the design draws', () => {
    render(<LogView model={model()} onScope={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'EXPOSURE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TRIP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ALL TIME' })).toBeInTheDocument();
  });

  it('marks the active scope pressed and fills it in the in-range hue', () => {
    render(<LogView model={model({ scope: 'trip' })} onScope={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'TRIP' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ALL TIME' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const pressed = ruleBody('.fwm-log-toggle-key[aria-pressed="true"]');
    expect(pressed).toContain('background: var(--fwm-alert-in-range);');
    // v2 ink: --fwm-text-on-alert, not the page ground. See `the v2 redesign`.
    expect(pressed).toContain('color: var(--fwm-text-on-alert);');
  });

  it('moves the fill when the other scope is active', () => {
    render(<LogView model={model({ scope: 'all-time' })} onScope={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'ALL TIME' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('renders the scope keys disabled rather than live-looking when nothing is wired', () => {
    render(<LogView model={model()} />);
    expect(screen.getByRole('button', { name: 'TRIP' })).toBeDisabled();
  });
});

describe('FLOCKED TODAY', () => {
  it('renders the day count and the unique-camera caption', () => {
    const { container } = render(<LogView model={model()} />);

    expect(screen.getByText('FLOCKED TODAY')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('12');
    expect(screen.getByText('CAMERAS · 4 UNIQUE')).toBeInTheDocument();
  });

  it('draws the hero in the in-range hue and never animates the digits', () => {
    const body = ruleBody('.fwm-log-hero');
    expect(body).toContain('color: var(--fwm-alert-in-range);');
    expect(body).not.toContain('transition');
    expect(body).not.toContain('animation');
  });

  it('prints a real zero rather than hiding an untroubled day', () => {
    const { container } = render(<LogView model={model({ todayPasses: 0, todayUnique: 0 })} />);
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('0');
  });
});

describe('the seven-day trend', () => {
  it('draws seven bars and seven weekday labels', () => {
    const { container } = render(<LogView model={model()} />);

    expect(container.querySelectorAll('.fwm-log-bar')).toHaveLength(7);
    expect(container.querySelectorAll('.fwm-log-axis span')).toHaveLength(7);
  });

  it('carries each bar height as a quantised step, never as an inline style', () => {
    const bars = sevenDayBars(
      [
        {
          id: 1,
          cameraId: 'cam-a',
          label: 'Reading Rd',
          atMs: MOMENT,
          state: 'in_range',
          previousState: 'clear',
          distanceFt: 380,
          speedMph: 47,
          headingDeg: 41,
          muted: false,
          outcome: null,
        },
      ],
      MOMENT,
    );
    const { container } = render(<LogView model={model({ bars })} />);

    const drawn = [...container.querySelectorAll<HTMLElement>('.fwm-log-bar')];
    expect(drawn[6]?.dataset['fwmLogBarLevel']).toBe('20');
    expect(drawn[6]?.dataset['fwmLogBarRank']).toBe('peak');
    for (const bar of drawn) expect(bar.getAttribute('style')).toBeNull();
    expect(ruleBody('.fwm-log-bar[data-fwm-log-bar-level="20"]')).toContain('height: 100%;');
  });

  it('gives an empty day a baseline tick instead of removing it from the week', () => {
    const { container } = render(<LogView model={model()} />);
    const drawn = [...container.querySelectorAll<HTMLElement>('.fwm-log-bar')];

    expect(drawn.every((bar) => bar.dataset['fwmLogBarLevel'] === '0')).toBe(true);
    expect(ruleBody('.fwm-log-bar[data-fwm-log-bar-level="0"]')).toContain(
      'height: var(--fwm-log-rule-w);',
    );
  });

  it('maps the two highlighted bars to alert tokens and to nothing else', () => {
    expect(ruleBody('.fwm-log-bar[data-fwm-log-bar-rank="peak"]')).toContain(
      'background: var(--fwm-alert-in-range);',
    );
    expect(ruleBody('.fwm-log-bar[data-fwm-log-bar-rank="second"]')).toContain(
      'background: var(--fwm-alert-approaching);',
    );
  });

  it('labels the axis with the days the bars cover', () => {
    const bars = sevenDayBars([], MOMENT);
    render(<LogView model={model({ bars })} />);

    for (const bar of bars) {
      expect(screen.getAllByText(bar.label).length).toBeGreaterThan(0);
    }
    expect(localDayStart(MOMENT)).toBe(bars[6]?.dayStartMs);
  });
});

describe('HOTTEST SEGMENT and ALL TIME', () => {
  it('names the segment and counts its cameras', () => {
    const { container } = render(<LogView model={model()} />);

    expect(screen.getByText('HOTTEST SEGMENT')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-log-segment-name="true"]')?.textContent).toBe(
      'Reading Rd',
    );
  });

  it('prints an em dash for the segment length, which nothing in this app measures', () => {
    render(<LogView model={model()} />);
    expect(screen.getByText(`5 CAMS / ${NO_VALUE} MI`)).toBeInTheDocument();
  });

  it('groups the all-time total and dates the record', () => {
    const { container } = render(<LogView model={model()} />);

    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe('1,284');
    expect(screen.getByText('SINCE MAR 2026')).toBeInTheDocument();
  });

  it('shows an em dash, not a zero, before the durable count has loaded', () => {
    const { container } = render(
      <LogView model={model({ allTimePasses: null, allTimeSinceMs: null })} />,
    );

    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe(NO_VALUE);
  });

  it('says so when nothing in scope carries a place name', () => {
    const { container } = render(<LogView model={model({ segment: null })} />);
    expect(container.querySelector('[data-fwm-log-segment-name="true"]')?.textContent).toBe(
      NO_VALUE,
    );
  });
});

describe('TIMELINE', () => {
  it('renders one row per pass, newest first, with the place, clock, speed and distance', () => {
    const { container } = render(<LogView model={model()} />);

    expect(screen.getByText('TIMELINE')).toBeInTheDocument();
    const rows = [...container.querySelectorAll<HTMLElement>('.fwm-log-row')];
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Vine St & 7th')).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText('14:22:08 · 47 MPH · 380 FT'),
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('I-71 N Exit 3')).toBeInTheDocument();
  });

  it('colours each row dot by the alert state that was recorded', () => {
    const { container } = render(<LogView model={model()} />);
    const dots = [...container.querySelectorAll<HTMLElement>('.fwm-log-row-dot')];

    expect(dots[0]?.dataset['fwmLogRowState']).toBe('in_range');
    expect(dots[1]?.dataset['fwmLogRowState']).toBe('approaching');
    expect(ruleBody('.fwm-log-row-dot[data-fwm-log-row-state="in_range"]')).toContain(
      'background: var(--fwm-alert-in-range);',
    );
    expect(ruleBody('.fwm-log-row-dot[data-fwm-log-row-state="approaching"]')).toContain(
      'background: var(--fwm-alert-approaching);',
    );
  });

  it('draws the amber row the design draws, which is an approaching row', () => {
    const { container } = render(<LogView model={model()} />);
    const dots = [...container.querySelectorAll<HTMLElement>('.fwm-log-row-dot')];

    // The design's middle row: `Reading Rd`, 760 FT against a 500 FT
    // threshold, dot #FFC02E. `LogScreen.test.tsx` proves the driving loop can
    // actually produce this row; this proves the panel draws it in that hue.
    expect(dots[1]?.dataset['fwmLogRowState']).toBe('approaching');
    expect(ruleBody('.fwm-log-row-dot[data-fwm-log-row-state="approaching"]')).toContain(
      'background: var(--fwm-alert-approaching);',
    );
  });

  it('declares no rule for a state a row cannot be in', () => {
    // A row is an encounter, and an encounter is never `clear`. A selector for
    // a row this screen cannot draw is a claim about a state that never
    // reaches the DOM.
    expect(logRules).not.toContain('data-fwm-log-row-state="clear"');
    for (const state of ['approaching', 'in_range', 'multiple']) {
      expect(logRules).toContain(`data-fwm-log-row-state="${state}"`);
    }
  });

  it('offers CONF and DISM on every row and marks the recorded one', () => {
    const { container } = render(<LogView model={model()} onOutcome={vi.fn()} />);
    const rows = [...container.querySelectorAll<HTMLElement>('.fwm-log-row')];

    const first = within(rows[0] as HTMLElement);
    expect(first.getByText('CONF')).toHaveAttribute('aria-pressed', 'true');
    expect(first.getByText('DISM')).toHaveAttribute('aria-pressed', 'false');

    const second = within(rows[1] as HTMLElement);
    expect(second.getByText('DISM')).toHaveAttribute('aria-pressed', 'true');
    expect(second.getByText('CONF')).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the recorded outcome in the two colours the design uses', () => {
    expect(
      ruleBody('.fwm-log-outcome[data-fwm-log-outcome-key="confirmed"][aria-pressed="true"]'),
    ).toContain('color: var(--fwm-alert-clear);');
    expect(
      ruleBody('.fwm-log-outcome[data-fwm-log-outcome-key="dismissed"][aria-pressed="true"]'),
    ).toContain('color: var(--fwm-text-muted);');
  });

  it('leaves an unruled row rulable', () => {
    const rows: readonly LogRow[] = [{ ...(ROWS[0] as LogRow), outcome: null }];
    const { container } = render(<LogView model={model({ rows })} onOutcome={vi.fn()} />);

    expect(container.querySelector<HTMLElement>('.fwm-log-row')?.dataset['fwmLogOutcome']).toBe(
      'none',
    );
    for (const key of screen.getAllByRole('button', { name: /Vine St/ })) {
      expect(key).toHaveAttribute('aria-pressed', 'false');
      expect(key).toBeEnabled();
    }
  });
});

describe('muted cameras', () => {
  it('draws a muted row exactly like an audible one', () => {
    const audible: readonly LogRow[] = [{ ...(ROWS[0] as LogRow), muted: false }];
    const silenced: readonly LogRow[] = [{ ...(ROWS[0] as LogRow), muted: true }];

    const first = render(<LogView model={model({ rows: audible })} />);
    const audibleHtml = root(first.container).innerHTML;
    first.unmount();

    const second = render(<LogView model={model({ rows: silenced })} />);
    const silencedHtml = root(second.container).innerHTML.replace(
      'data-fwm-log-muted="true"',
      'data-fwm-log-muted="false"',
    );

    expect(silencedHtml).toBe(audibleHtml);
  });

  it('has no stylesheet rule that dims or hides a muted row', () => {
    expect(logRules).not.toContain('data-fwm-log-muted');
  });
});

describe('empty states', () => {
  it('says the window is empty instead of drawing a row that never happened', () => {
    const { container } = render(<LogView model={model({ rows: [] })} />);

    expect(container.querySelectorAll('.fwm-log-row')).toHaveLength(0);
    expect(screen.getByText('NO CAMERAS THIS TRIP')).toBeInTheDocument();
  });

  it('names the window that came up empty', () => {
    expect(emptyTimelineMessage('trip', true)).toBe('NO CAMERAS THIS TRIP');
    expect(emptyTimelineMessage('trip', false)).toBe('NO TRIP IN PROGRESS');
    expect(emptyTimelineMessage('all-time', false)).toBe('NO CAMERAS RECORDED');
  });
});

describe('HEAT MAP and ZONE AUDIT', () => {
  it('draws both keys at the bottom of the panel', () => {
    render(<LogView model={model()} onHeatMap={vi.fn()} onZoneAudit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'HEAT MAP' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'ZONE AUDIT' })).toBeEnabled();
  });

  it('renders a key with no destination disabled rather than inert and live-looking', () => {
    render(<LogView model={model()} />);

    expect(screen.getByRole('button', { name: 'HEAT MAP' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ZONE AUDIT' })).toBeDisabled();
  });
});

describe('chrome that belongs to the shell', () => {
  it('draws no second REPORT bar and no second dock', () => {
    render(<LogView model={model()} />);

    expect(screen.queryByText('REPORT CAMERA')).not.toBeInTheDocument();
    expect(screen.queryByText('RADAR')).not.toBeInTheDocument();
    expect(screen.queryByText('SWEEP')).not.toBeInTheDocument();
  });
});

describe('no hover affordance', () => {
  it('declares no :hover rule anywhere in log.css', () => {
    expect(logRules).not.toContain(':hover');
  });

  it('carries no hover variant on any attribute in the rendered tree', () => {
    const { container } = render(<LogView model={model()} />);
    for (const el of container.querySelectorAll('*')) {
      for (const attribute of el.attributes) {
        expect(attribute.value.toLowerCase()).not.toContain('hover');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The v2 redesign
//
// `.design-src-v2/Flockys App Screens v2.dc.html` against
// `.design-src/Flockys App Screens.dc.html`, panel `05 · LOG - EXPOSURE`, style
// by style. Six moves, no copy change. Each test names the token v2 draws AND
// the v1 token that must no longer appear, so a revert fails loudly instead of
// quietly leaving the screen half-redesigned.
// ---------------------------------------------------------------------------

describe('the v2 redesign', () => {
  it('fills the scope track instead of ruling it', () => {
    const track = ruleBody('.fwm-log-toggle');

    expect(track).toContain('background: var(--fwm-surface-track);');
    expect(track).toContain('border-radius: var(--fwm-radius-3);');
    expect(track).toContain('border: none;');
    // v1 drew a 1px --fwm-line box at radius 2. Both are gone.
    expect(track).not.toContain('--fwm-line');
    expect(track).not.toContain('--fwm-radius-1');
  });

  it('insets the scope keys off the track rather than mounting them flush', () => {
    const track = ruleBody('.fwm-log-toggle');

    expect(track).toContain('padding: var(--fwm-space-1);');
    expect(track).toContain('gap: var(--fwm-space-1);');
  });

  it('inks the selected scope on the alert fill, not on the page ground', () => {
    const pressed = ruleBody('.fwm-log-toggle-key[aria-pressed="true"]');

    expect(pressed).toContain('color: var(--fwm-text-on-alert);');
    expect(pressed).toContain('border-radius: var(--fwm-radius-2);');
    // A mode that lifts --fwm-bg off black must not drag this label with it.
    expect(pressed).not.toContain('var(--fwm-bg)');
  });

  it('keeps the scope key at its drawn height and extends the hit area to the floor', () => {
    // v2 draws the key 30px selected / 34px not, under the 44px touch floor.
    // The drawn box holds; a transparent ::before takes the target to the floor.
    expect(ruleBody('.fwm-log-toggle-key')).toContain('height: var(--fwm-log-key-h);');

    const hit = ruleBody('.fwm-log-toggle-key::before');
    expect(hit).toContain(
      'inset-block: calc((var(--fwm-touch-min) - var(--fwm-log-key-h)) / -2);',
    );
    expect(hit).toContain('background: transparent;');
    // A clipped track would cut the overhang back under the floor.
    expect(ruleBody('.fwm-log-toggle')).not.toContain('overflow');
  });

  it('lifts every card off the ground with a fill instead of a hairline', () => {
    const card = ruleBody('.fwm-log-card');

    expect(card).toContain('border: none;');
    expect(card).toContain('background: var(--fwm-surface-card);');
    expect(card).toContain('border-radius: var(--fwm-radius-2);');
    // v1: 1px --fwm-line over --fwm-surface-1 at radius 2.
    expect(card).not.toContain('--fwm-surface-1');
    expect(card).not.toContain('--fwm-line');
    expect(card).not.toContain('--fwm-radius-1');
  });

  it('rules a timeline row with the soft line and the header with the chrome line', () => {
    // A separator inside a list is quieter than the rule that closes the header.
    expect(ruleBody('.fwm-log-row')).toContain(
      'border-bottom: var(--fwm-log-rule-w) solid var(--fwm-line-soft);',
    );
    expect(ruleBody('.fwm-log-header')).toContain(
      'border-bottom: var(--fwm-log-rule-w) solid var(--fwm-line);',
    );
  });

  it('keeps the outline on HEAT MAP and ZONE AUDIT and moves only the radius', () => {
    // "Flat borderless controls" stripped the scope track and all three cards.
    // These two are destinations off the screen, and v2 left them their edge.
    const action = ruleBody('.fwm-log-action');

    expect(action).toContain('border: var(--fwm-log-rule-w) solid var(--fwm-line-strong);');
    expect(action).toContain('border-radius: var(--fwm-radius-3);');
    expect(action).not.toContain('--fwm-radius-1');
  });

  it('leaves the seven-day trend exactly as v1 drew it', () => {
    // v2 redrew this card's shell and not one pixel of the plot inside it.
    expect(ruleBody('.fwm-log-bar')).toContain('background: var(--fwm-line);');
    expect(ruleBody('.fwm-log-bar[data-fwm-log-bar-rank="peak"]')).toContain(
      'background: var(--fwm-alert-in-range);',
    );
    expect(ruleBody('.fwm-log-bar[data-fwm-log-bar-rank="second"]')).toContain(
      'background: var(--fwm-alert-approaching);',
    );
    expect(ruleBody('.fwm-log-bars')).toContain('height: var(--fwm-log-plot-h);');
  });

  it('leaves CONF and DISM in the two colours v1 and v2 both draw them in', () => {
    // The one control v2 did not touch: no fill, no radius, no edge -- a word.
    const base = ruleBody('.fwm-log-outcome');
    expect(base).toContain('background: transparent;');
    expect(base).toContain('height: var(--fwm-touch-min);');
    expect(
      ruleBody('.fwm-log-outcome[data-fwm-log-outcome-key="confirmed"][aria-pressed="true"]'),
    ).toContain('color: var(--fwm-alert-clear);');
    expect(
      ruleBody('.fwm-log-outcome[data-fwm-log-outcome-key="dismissed"][aria-pressed="true"]'),
    ).toContain('color: var(--fwm-text-muted);');
  });

  it('carries the whole redesign in tokens, with no literal anywhere', () => {
    // The gate is `scripts/check-design-values.mjs`; this is the same contract
    // asserted where the file is edited, so a raw value fails at the unit.
    expect(logRules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(logRules).not.toMatch(/(?<![\w-])\d*\.?\d+px/);
    expect(logRules).not.toContain('cubic-bezier');
  });

  it('still counts a muted camera, which is a product rule and not a style', () => {
    // v2 redrew the row's rule colour and nothing else about a muted row.
    // `LogScreen.test.tsx` proves the count; this proves the redesign added no
    // selector that could dim, hide or re-rank one.
    expect(logRules).not.toContain('data-fwm-log-muted');

    const silenced: readonly LogRow[] = [{ ...(ROWS[0] as LogRow), muted: true }];
    const { container } = render(<LogView model={model({ rows: silenced })} />);

    expect(container.querySelectorAll('.fwm-log-row')).toHaveLength(1);
    expect(container.querySelector<HTMLElement>('.fwm-log-row')?.dataset['fwmLogMuted']).toBe(
      'true',
    );
  });
});

describe('no inline style reaches the DOM', () => {
  it('renders the whole panel without a single style attribute', () => {
    const { container } = render(<LogView model={model()} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
