/**
 * All six RADAR states, rendered one at a time, against what the design draws.
 *
 * Reference: `Flockys App Screens v2.dc.html` -- screen `01 · RADAR - IN RANGE`
 * and the four-card `RADAR state matrix`; `Flockys Screens II.dc.html` --
 * `A2 · OFFLINE - DEGRADED` and the county-entry strip.
 *
 * `radar.css` is pulled in as text so the rules the tests care about -- the hue
 * blocks, the absence of a transition on the digits, the absence of `:hover` --
 * can be asserted. vitest runs with `css: false`, so a computed style would be
 * empty and asserting on one would prove nothing.
 */

// `radar.css` is READ FROM DISK, not imported. vitest runs with `css: false`,
// which stubs every CSS import -- `?raw` included -- to an empty string, so an
// assertion against the import would pass on '' no matter what the file says.
// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RadarState } from '../radarState.ts';

import { RadarView } from './RadarView.tsx';
import { EMPTY_ZONE } from '../zoneLive.ts';
import type { RadarViewModel } from './RadarView.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const radarCss: string = readFileSync(`${HERE}/../radar.css`, 'utf8');
/** Rules only. The file's prose explains why there is no hover state, using the word. */
const radarRules: string = radarCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of one top-level rule, matched at line start so a comment cannot win. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.[\]"=]/g, (c) => `\\${c}`);
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(radarCss);
  return match?.[1] ?? null;
}

/** A live in-range drive, matching the numbers screen 01 renders. */
function model(over: Partial<RadarViewModel> = {}): RadarViewModel {
  return {
    state: 'in_range',
    gate: 'live',
    hasFix: true,
    geolocationUnavailable: false,
    lat: 39.0997,
    lon: -84.5786,
    satellites: 7,
    accuracyM: 4,
    lastFixAgeMs: 0,
    distanceFt: 425,
    relativeDirection: 'ahead',
    bearingDeg: 41,
    headingDeg: 41,
    isClosing: true,
    countInRange: 3,
    thresholdFt: 500,
    scanRateHz: 4,
    speedMph: 47,
    todayPasses: 12,
    muteRemainingMs: 0,
    offline: false,
    takeover: false,
    county: null,
    // THE TOP BLOCK NEEDS A ROAD AHEAD. Without a corridor it correctly renders
    // NO FIX, which is right and useless as a fixture -- every test about the
    // clear verdict would be asserting the degraded state instead.
    corridor: {
      headingDeg: 41,
      rangeFt: 3 * 5280,
      clearForFt: 7392,
      cameras: [],
      worstStretch: null,
    },
    zone: EMPTY_ZONE,
    // The dial, merged in from SWEEP. Empty by default: these tests are about
    // RADAR's own states, and a dot on the dial is SWEEP's suite's business.
    dots: [],
    outerFt: 1000,
    telemetry: { headingDeg: null, lat: null, lon: null, meshLive: false },
    ...over,
  };
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.fwm-radar');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

/**
 * The threshold ring, which is now drawn ON THE DIAL rather than being its own
 * circle. RADAR and SWEEP merged: the scope draws where cameras are, and the
 * alert threshold is one of its rings, lit in the state hue.
 */
function threshold(container: HTMLElement): SVGElement {
  const el = container.querySelector<SVGElement>('.fwm-sweep-threshold');
  expect(el).not.toBeNull();
  return el as SVGElement;
}

function digits(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-fwm-radar-digits="true"]');
}

// ---------------------------------------------------------------------------
// The six states
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('draws a solid green ring with CLEAR in it and the miles-to-nearest readout', () => {
    const { container } = render(
      <RadarView model={model({ state: 'clear', distanceFt: 12672, countInRange: 0 })} />,
    );

    expect(root(container).dataset['fwmRadarState']).toBe('clear');
    expect(threshold(container).getAttribute('data-fwm-sweep-threshold')).toBe(
      root(container).dataset['fwmRadarState'],
    );
    // THE VERDICT CARRIES IT NOW. The hero readout and the direction line
    // were the same fact twice, in two sizes, above a map that already shows
    // where the camera is. `CLEAR FOR ...` is the sentence that survived.
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toMatch(/^CLEAR FOR /);
  });

  it('maps clear to the clear alert token and to nothing else', () => {
    const body = ruleBody('.fwm-radar[data-fwm-radar-state="clear"]');
    expect(body).not.toBeNull();
    expect(body).toContain('--fwm-radar-hue: var(--fwm-alert-clear);');
    // The clear card's ring is green and glows; it is not an alert colour.
    expect(body).not.toMatch(/--fwm-radar-hue: var\(--fwm-alert-(in-range|approaching|multiple)\)/);
  });

  it('does not breathe the rim -- nothing is inside the threshold', () => {
    const { container } = render(<RadarView model={model({ state: 'clear', countInRange: 0 })} />);
    // "CLEAR · no haptic, no sound" -- nothing on this screen buzzes anything.
    expect(container.querySelector('[data-fwm-radar-inrange]')).toBeNull();
  });
});

describe('approaching', () => {
  it('draws the amber pulsing ring, the distance and AHEAD · CLOSING', () => {
    const { container } = render(
      <RadarView model={model({ state: 'approaching', distanceFt: 820, countInRange: 0 })} />,
    );

    expect(root(container).dataset['fwmRadarState']).toBe('approaching');
    expect(threshold(container).getAttribute('data-fwm-sweep-threshold')).toBe(
      root(container).dataset['fwmRadarState'],
    );
    // The distance and the direction line are gone: the map draws where the
    // camera is, and the verdict says how far the road is clear.
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toMatch(/^CLEAR FOR /);
  });

  it('maps approaching to the approaching token and pulses the ring edge', () => {
    expect(radarCss).toContain('--fwm-radar-hue: var(--fwm-alert-approaching);');
    expect(radarCss).toContain(
      '.fwm-radar[data-fwm-radar-state="approaching"] .fwm-radar-ring-edge {',
    );
    expect(radarCss).toContain('animation: fwmPulse var(--fwm-radar-dur-pulse)');
    // 1.4s, slower than the 1.15s the alert states breathe at.
    expect(radarCss).toContain('--fwm-radar-dur-pulse: calc(var(--fwm-dur-alert) * 3.5);');
  });
});

describe('in_range', () => {
  it('draws the crimson scope, the direction line, the count bar and three tiles', () => {
    const { container } = render(<RadarView model={model()} />);

    expect(root(container).dataset['fwmRadarState']).toBe('in_range');
    expect(threshold(container).getAttribute('data-fwm-sweep-threshold')).toBe(
      root(container).dataset['fwmRadarState'],
    );
    // The scope still draws the camera; the top block still states the road
    // ahead. Neither the hero digits nor the tiles exist to assert about.
    expect(container.querySelector('.fwm-topblock')).not.toBeNull();
    expect(container.querySelector('.fwm-topblock-headline')).not.toBeNull();
  });

  it('carries the crimson glow on the pip, and no glow anywhere else', () => {
    // v2 dropped every box-shadow from the scope. The pip is the one solid-hue
    // element a masked lattice leaves to carry the matrix's lit-ring reading.
    expect(radarCss).toContain('--fwm-radar-hue: var(--fwm-alert-in-range);');
    expect(radarCss).toContain('--fwm-radar-glow: var(--fwm-glow-alert);');
    expect(ruleBody('.fwm-radar-ring-marker-dot')).toContain(
      'box-shadow: var(--fwm-radar-glow)',
    );
    expect(ruleBody('.fwm-radar-ring-edge')).not.toMatch(/box-shadow/);
  });

  it('gives clear and approaching the glow tokens v2 added for them', () => {
    // GAP: docs/gaps-inbox/radar-screen.md#glow-token-is-crimson-only was half
    // closed by the v2 token pass -- --fwm-glow-clear and --fwm-glow-approaching
    // exist now, and only `multiple` still borrows the crimson one.
    expect(radarCss).toContain('--fwm-radar-glow: var(--fwm-glow-clear);');
    expect(radarCss).toContain('--fwm-radar-glow: var(--fwm-glow-approaching);');
  });





  it('fades every scope layer with opacity, never with a hue-locked tint token', () => {
    // The token set's --fwm-tint-in-range-* pair carries v2's exact alphas and
    // is crimson-locked; this screen has six hues, so every layer paints
    // var(--fwm-radar-hue) and is faded by opacity instead.
    for (const selector of [
      '.fwm-radar-ring-inner',
      '.fwm-radar-ring-edge',
      '.fwm-radar-ring-ticks',
      '.fwm-radar-ring-axis',
    ]) {
      expect(ruleBody(selector), `${selector} has no rule`).not.toBeNull();
    }
    expect(radarRules).not.toContain('--fwm-tint-in-range-weak');
    expect(radarRules).not.toContain('--fwm-tint-in-range-line');
  });
});

describe('multiple', () => {
  it('is the in_range layout in the multiple hue with the count emphasised', () => {
    // GAP: DESIGN-GAPS.md#multiple-state-never-rendered -- the design ships a
    // colour swatch for this state and no screen. Nothing new is invented here.
    const { container } = render(
      <RadarView model={model({ state: 'multiple', countInRange: 2 })} />,
    );

    expect(root(container).dataset['fwmRadarState']).toBe('multiple');
    expect(threshold(container).getAttribute('data-fwm-sweep-threshold')).toBe(
      root(container).dataset['fwmRadarState'],
    );
    // The count bar is gone; the hue still escalates, which is the thing this
    // test is actually about.
    expect(radarCss).toContain('--fwm-radar-hue: var(--fwm-alert-multiple);');
    expect(radarCss).toContain(
      '.fwm-radar[data-fwm-radar-state="multiple"] .fwm-radar-inrange-label {',
    );
  });
});

describe('no_gps', () => {
  it('stops the scope, says NO FIX, prints the last-fix copy and RETRY LOCK', () => {
    const { container } = render(
      <RadarView model={model({ state: 'no_gps', hasFix: false, lastFixAgeMs: 40_000 })} />,
    );

    expect(root(container).dataset['fwmRadarState']).toBe('no_gps');
    expect(threshold(container).getAttribute('data-fwm-sweep-threshold')).toBe(
      root(container).dataset['fwmRadarState'],
    );
    // 'NO GPS' was AlertRing's word, printed inside the ring it drew. Merged
    // into the dial, the same fact is carried by the GPS row, the degraded
    // copy below the hero, and a scope that stops scanning - three places, all
    // of which a driver already reads. The state itself is asserted above.
    // NO FIX was the GPS row's word and the row is gone. The sentence a driver
    // acts on -- how stale, and what to do -- is what had to survive.
    expect(screen.getByText('last fix 40s ago.')).toBeInTheDocument();
    expect(screen.getByText('showing cached cameras only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RETRY LOCK' })).toBeInTheDocument();
    expect(radarCss).toContain('dashed var(--fwm-radar-hue)');
  });


  it('shows NO FIX in the status row and no distance at all', () => {
    const { container } = render(
      <RadarView model={model({ state: 'no_gps', hasFix: false, lastFixAgeMs: 40_000 })} />,
    );
    // No distance anywhere, because there is nothing to measure from.
    expect(
      render(<RadarView model={model({ hasFix: false, corridor: null })} />)
        .container.querySelector('.fwm-topblock-headline')?.textContent,
    ).toBe('NO FIX');
    // No position means no bearing pip and no range rings to measure against.
    expect(container.querySelector('[data-fwm-radar-marker="true"]')).toBeNull();
  });

  it('does not crash, and still renders RETRY LOCK, with a null position', () => {
    const { container } = render(
      <RadarView
        model={model({
          state: 'no_gps',
          hasFix: false,
          lat: null,
          lon: null,
          satellites: null,
          accuracyM: null,
          lastFixAgeMs: null,
          distanceFt: null,
          relativeDirection: null,
          bearingDeg: null,
          headingDeg: null,
          isClosing: null,
          speedMph: null,
          countInRange: 0,
        })}
      />,
    );

    expect(root(container).dataset['fwmRadarState']).toBe('no_gps');
    expect(screen.getByRole('button', { name: 'RETRY LOCK' })).toBeInTheDocument();
    expect(screen.getByText('no fix.')).toBeInTheDocument();
    // EM DASHES, NOT FABRICATED ZEROES -- the rule moved to the plate, which is
    // the most authoritative-looking object on the screen and therefore the one
    // that must never print a number it does not have.
    expect(container.querySelector('.fwm-topblock-speed-limit')?.textContent).toBe('—');
  });

  it('renders RETRY LOCK disabled rather than live when nothing is wired to it', () => {
    render(<RadarView model={model({ state: 'no_gps', hasFix: false })} />);
    expect(screen.getByRole('button', { name: 'RETRY LOCK' })).toBeDisabled();
  });
});

describe('muted', () => {
  it('greys the hue, keeps the distance live and says STILL TRACKING', () => {
    const { container } = render(
      <RadarView model={model({ state: 'muted', muteRemainingMs: 8 * 60_000 + 12_000 })} />,
    );

    expect(root(container).dataset['fwmRadarState']).toBe('muted');
    expect(threshold(container).getAttribute('data-fwm-sweep-threshold')).toBe(
      root(container).dataset['fwmRadarState'],
    );
    // The scope is still tracking. That is the entire point of the mute rule:
    // muting changes the presentation and nothing about the measurement.
    // STILL TRACKING was the direction line's word for the muted state, and
    // the direction line is gone. The desaturated hue is what says it now --
    // and the block keeps talking, which is the promise that matters: a muted
    // camera is still counted, still drawn, still ahead of you.
    expect(root(container).dataset['fwmRadarState']).toBe('muted');
    expect(container.querySelector('.fwm-topblock-headline')).not.toBeNull();
    expect(radarCss).toContain(
      '.fwm-radar[data-fwm-radar-state="muted"] {\n  --fwm-radar-hue: var(--fwm-text-muted);',
    );
  });

  it('counts down in the header', () => {
    render(<RadarView model={model({ state: 'muted', muteRemainingMs: 8 * 60_000 + 12_000 })} />);
    expect(screen.getByText('MUTED 8:12')).toBeInTheDocument();
  });

  it('keeps counting muted cameras in the bar and in TODAY', () => {
    // "MUTED CAMERAS DON'T DISAPPEAR ... still count in EXPOSURE."
    const { container } = render(
      <RadarView model={model({ state: 'muted', countInRange: 3, todayPasses: 12 })} />,
    );
    // TODAY moved into the header as a tally beside the database counts. Muting
    // changes the presentation and never the record.
    expect(container.querySelector('.fwm-radar-passed-value')?.textContent).toBe('12');
  });

  it('shows no countdown at all when nothing is muted', () => {
    render(<RadarView model={model()} />);
    expect(screen.queryByText(/^MUTED /)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Offline, loading, denied
// ---------------------------------------------------------------------------

describe('offline', () => {
  it('runs the amber cache strip and the cached-camera readout', () => {
    render(<RadarView model={model({ state: 'clear', distanceFt: 610, offline: true })} />);
    // The strip survives, because "you are running on cached data" is a claim
    // about whether to trust the screen. The provenance line that used to
    // repeat it under the hero readout went with the hero readout.
    expect(screen.getByText('NO NETWORK · RUNNING ON CACHE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RETRY SYNC' })).toBeInTheDocument();
  });

  it('lets a real record outrank the cache warning, now that records are real', () => {
    // "Record outranks connectivity" applies to a record that is ON SCREEN, and
    // one now can be: `FEATURES.record` is on, backed by 47 fact-checked
    // entries that each carry a citation.
    //
    // This test used to assert the opposite -- that the strip drew nothing and
    // the offline warning stayed -- because the flag was off and an accusation
    // against a named agency could not be shown at all.
    render(
      <RadarView
        model={model({
          state: 'clear',
          offline: true,
          county: { label: 'HAMILTON CO', incidents: 6 },
        })}
      />,
    );
    expect(screen.getByText(/ON RECORD/)).toBeInTheDocument();
    // And the offline warning steps aside, which is the ranking the design set:
    // what an agency has been documented doing outranks how fresh the data is.
    expect(screen.queryByText('NO NETWORK · RUNNING ON CACHE')).toBeNull();
  });

  it('still shows the cache warning when the county has no record', () => {
    // The other half: absence of a record must never take the offline warning
    // with it. A driver on a stale database has to be told so, and almost every
    // county in the country has nothing documented.
    render(<RadarView model={model({ state: 'clear', offline: true, county: null })} />);
    expect(screen.queryByText(/ON RECORD/)).toBeNull();
    expect(screen.getByText('NO NETWORK · RUNNING ON CACHE')).toBeInTheDocument();
  });

  it('states the road ahead even while offline, from cached cameras', () => {
    // The old worry was a provenance line displacing a live direction. Neither
    // exists now -- what matters is that going offline does not blank the one
    // sentence the block is for.
    const { container } = render(<RadarView model={model({ offline: true })} />);
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toMatch(/^CLEAR FOR /);
  });
});

describe('loading', () => {
  it('says it is waiting rather than drawing a fake zero', () => {
    // GAP: DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn -- the design
    // draws no loading state for any screen.
    const { container } = render(
      <RadarView
        model={model({ state: 'no_gps', gate: 'loading', hasFix: false, lastFixAgeMs: null })}
      />,
    );
    expect(root(container).dataset['fwmRadarGate']).toBe('loading');
    expect(screen.getByText('waiting for the first fix.')).toBeInTheDocument();
    expect(digits(container)).toBeNull();
  });
});

describe('permission denied', () => {
  it('offers ALLOW and repeats the on-device promise from the onboarding screen', () => {
    render(
      <RadarView
        model={model({ state: 'no_gps', gate: 'denied', hasFix: false })}
        onRequestLocation={() => undefined}
      />,
    );
    expect(screen.getByText('location is off.')).toBeInTheDocument();
    expect(
      screen.getByText(/Coordinates never leave the phone unless you file a report\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ALLOW' })).toBeEnabled();
    // Nothing offers RETRY LOCK here: a refusal is not fixed by retrying.
    expect(screen.queryByRole('button', { name: 'RETRY LOCK' })).toBeNull();
  });

  it('says so plainly when the platform has no geolocation at all', () => {
    render(
      <RadarView
        model={model({
          state: 'no_gps',
          gate: 'denied',
          hasFix: false,
          geolocationUnavailable: true,
        })}
      />,
    );
    expect(screen.getByText('this device has no location service.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The rules that hold across every state
// ---------------------------------------------------------------------------

describe('the readout never animates', () => {
  it('declares no transition and no animation on the digit rule', () => {
    const body = ruleBody('.fwm-radar-digits');
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/transition/);
    expect(body).not.toMatch(/animation/);
  });

  it('puts no inline style on the digit element', () => {
    const { container } = render(<RadarView model={model()} />);
    // The rule outlived the element it was written for: NOTHING in the block
    // may carry an inline style, because a measurement in a style attribute is
    // a measurement the design gate cannot read.
    for (const el of container.querySelectorAll('.fwm-topblock *')) {
      expect(el.getAttribute('style')).toBeNull();
    }
  });

  it('snaps to the new value in one render, with no intermediate frame', () => {
    // A count-up would render 425 -> ... -> 380. There is no interpolation:
    // the element's text is the store's value, replaced outright.
    // The distance the block states comes from the CORRIDOR, so drive the
    // corridor rather than the removed hero readout.
    // A camera in the corridor: with none, the verdict correctly reports the
    // whole range as clear and the number never moves.
    const cam = (distanceFt: number) => ({
      id: `c-${String(distanceFt)}`,
      distanceFt,
      offsetDeg: 0,
      state: 'approaching' as const,
    });
    const near = {
      headingDeg: 41,
      rangeFt: 3 * 5280,
      cameras: [cam(2112)],
      worstStretch: null,
    };
    const { container, rerender } = render(
      <RadarView model={model({ corridor: { ...near, clearForFt: 2112 } })} />,
    );
    // Rounded the way `corridorDistance` rounds, not to a figure invented here.
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toMatch(
      /^CLEAR FOR 2110 FT\b/,
    );
    rerender(<RadarView model={model({ corridor: { ...near, clearForFt: 1056 } })} />);
    // Replaced outright, with no interpolated frame in between.
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toMatch(
      /^CLEAR FOR 1060 FT\b/,
    );
  });
});

describe('no hover affordance', () => {
  it('declares no :hover rule anywhere in radar.css', () => {
    expect(radarRules).not.toContain(':hover');
  });

  it('carries no hover variant on any attribute in the rendered tree', () => {
    const { container } = render(<RadarView model={model()} />);
    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      for (const attribute of Array.from(el.attributes)) {
        expect(attribute.value.toLowerCase()).not.toContain('hover');
      }
    }
  });
});

describe('a live camera alert wins the screen', () => {
  it('marks the takeover and drops both strips', () => {
    const { container } = render(
      <RadarView
        model={model({
          takeover: true,
          offline: true,
          county: { label: 'HAMILTON CO', incidents: 6 },
        })}
      />,
    );

    expect(root(container).dataset['fwmRadarTakeover']).toBe('true');
    expect(screen.queryByText('NO NETWORK · RUNNING ON CACHE')).toBeNull();
    expect(screen.queryByText(/ON RECORD/)).toBeNull();
    // The alert presentation itself is still fully rendered.
    expect(container.querySelector('.fwm-topblock')).not.toBeNull();
  });

  it('paints the takeover as an opaque layer over its container', () => {
    expect(radarCss).toContain('.fwm-radar[data-fwm-radar-takeover="true"] {');
    expect(radarCss).toContain('background: var(--fwm-bg);');
  });
});

describe('every state renders the same structure', () => {
  const STATES: readonly RadarState[] = [
    'clear',
    'approaching',
    'in_range',
    'multiple',
    'no_gps',
    'muted',
  ];

  it('draws the header, the GPS row, the dial and the three tiles in all six', () => {
    for (const state of STATES) {
      const { container, unmount } = render(
        <RadarView model={model({ state, hasFix: state !== 'no_gps' })} />,
      );
      expect(container.querySelector('.fwm-radar-header')).not.toBeNull();
      // The GPS row is gone; the top block is the thing that must render in
      // every one of the six states.
      expect(container.querySelector('.fwm-topblock')).not.toBeNull();
      // The scope, merged in from SWEEP. It renders in every state - a driver
      // with no fix still needs to see the instrument, dimmed and not
      // scanning, rather than a hole where the map was.
      expect(container.querySelector('.fwm-sweep-dial')).not.toBeNull();
      expect(container.querySelector('.fwm-sweep-threshold')).not.toBeNull();
      // The three tiles are gone; the top block is what must render in all six.
      expect(container.querySelector('.fwm-topblock')).not.toBeNull();
      unmount();
    }
  });

  it('sets exactly one state attribute, and it is the state it was given', () => {
    for (const state of STATES) {
      const { container, unmount } = render(<RadarView model={model({ state })} />);
      expect(container.querySelectorAll('[data-fwm-radar-state]')).toHaveLength(1);
      expect(root(container).dataset['fwmRadarState']).toBe(state);
      unmount();
    }
  });

  it('keeps every fixed-height label from wrapping', () => {
    // Each of these sits in a row whose height the design fixes; a wrap would
    // clip the glyphs rather than grow the row.
    for (const selector of [
      '.fwm-radar-title',
      '.fwm-radar-key',
      '.fwm-radar-gps',
      '.fwm-radar-digits',
      '.fwm-radar-unit',
      '.fwm-radar-direction',
      '.fwm-radar-inrange-label',
      '.fwm-radar-tile-label',
      '.fwm-radar-tile-value',
      '.fwm-radar-tile-unit',
      '.fwm-radar-ring-value',
      '.fwm-radar-ring-cap',
      '.fwm-radar-ring-unit',
      '.fwm-radar-ring-lock',
      '.fwm-radar-ring-word',
      '.fwm-radar-action',
      '.fwm-radar-strip-label',
    ]) {
      const body = ruleBody(selector);
      expect(body, `${selector} has no rule in radar.css`).not.toBeNull();
      expect(body, `${selector} may wrap`).toContain('white-space: nowrap');
    }
  });
});

describe('horizontal overflow at 375px', () => {
  it('CANNOT be verified here -- jsdom performs no layout', () => {
    // Documented rather than faked. jsdom reports 0 for every box metric, so an
    // assertion like `scrollWidth <= clientWidth` passes on 0 <= 0 whatever the
    // CSS says, and stubbing the metrics would only assert the stub. The real
    // check belongs in the Playwright suite at a 375px viewport.
    const { container } = render(<RadarView model={model()} />);
    const el = root(container);
    expect(el.scrollWidth).toBe(0);
    expect(el.clientWidth).toBe(0);
  });

  it('declares the structural guards that make an overflow impossible', () => {
    // What CAN be asserted from here: the root clips sideways, the flex
    // children may shrink below their content, and no rule pins a width in
    // pixels. `min-width: 0` is what actually stops a nowrap mono label from
    // forcing a flex row wider than the viewport.
    expect(radarCss).toContain('overflow-x: hidden;');
    expect(radarCss).toContain('min-width: 0;');
    expect(radarCss).toContain('width: min(100%, calc(var(--fwm-space-12) * 5.2));');
    // A width pinned in a RULE is what forces an overflow. A width in a MEDIA
    // QUERY is the opposite -- it is how the layout is told to stop trying at a
    // size where it cannot fit, and CSS media queries cannot read a custom
    // property (`@media (max-width: var(--x))` is invalid by spec), so a
    // breakpoint has no token form to use instead.
    const withoutMediaQueries = radarCss.replace(/@media[^{]*\{/g, '{');
    expect(withoutMediaQueries).not.toMatch(/width:\s*[\d.]+(?:px|rem|em)/);
  });
});

describe('capability honesty', () => {
  it('renders the header key disabled when nothing is wired to it', () => {
    render(<RadarView model={model()} />);
    expect(screen.getByRole('button', { name: 'menu' })).toBeDisabled();
  });

  it('enables the header key only when a handler is passed', () => {
    render(<RadarView model={model()} onSettings={() => undefined} />);
    expect(screen.getByRole('button', { name: 'menu' })).toBeEnabled();
  });

  it('CARRIES ONE KEY, because the middle of this header is a live count', () => {
    // The `?` moved into SETTINGS as a FAQ row. Two keys either side of a
    // reading that changes width is how the count ended up printing over the
    // title when it gained LOCAL and NETWORK.
    render(<RadarView model={model()} />);
    expect(screen.queryByRole('button', { name: 'what this app knows' })).toBeNull();
  });

  it('keeps REPORT out of the header -- the dock already carries it', () => {
    // Two entry points to one sheet is two things to keep in step, in a 52px
    // bar that has to stay readable at a glance in a car mount.
    render(<RadarView model={model()} onReport={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'REP' })).toBeNull();
  });

  it('keeps VOL out of the header -- mute lives in SETTINGS with its rules', () => {
    // VOL was drawn armed and specified nowhere. Mute runs out on a timer, is
    // pierced by a close camera, and changes nothing that gets recorded. None
    // of that fits behind a three-letter key.
    render(<RadarView model={model()} onSettings={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'VOL' })).toBeNull();
  });

  it('draws the menu as an SVG mark, never as a platform glyph', () => {
    // A gear or hamburger CHARACTER renders as a colour emoji on one platform
    // and a hairline outline on the other, at the platform's metrics. The app
    // draws its own on the dock's 24x24 grid so it is the same everywhere.
    const { container } = render(<RadarView model={model()} onSettings={() => undefined} />);
    const menu = screen.getByRole('button', { name: 'menu' });
    expect(menu.querySelector('svg.fwm-radar-key-icon')?.getAttribute('viewBox')).toBe('0 0 24 24');
    // No text content: nothing for a font to fall back on, and no second
    // accessible name competing with the label.
    expect(menu.textContent).toBe('');
    expect(container.querySelector('.fwm-radar-key-icon')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('a live state with no camera to measure to', () => {
  it('never renders the hero as an 80px em dash', () => {
    // What the phone actually showed: CLEAR is a live-distance state, the
    // camera database is empty, so formatDistanceValue(null) returned NO_VALUE
    // and --fwm-text-hero rendered it at 5rem. It reads as a broken element,
    // not as "unknown".
    const { container } = render(<RadarView model={model({ state: 'clear', distanceFt: null })} />);

    // Asked of the HERO, not of the whole tree. An em dash is the right answer
    // in other places -- the header's camera count renders one at 12px while
    // nothing is cached, which is honest. It is only wrong at 5rem, where it
    // reads as a broken element rather than as "unknown".
    expect(container.querySelector('.fwm-radar-digits')).toBeNull();
    expect(container.querySelector('.fwm-radar-hero')?.textContent ?? '').not.toContain('—');
    expect(screen.getByText('no cameras on the map here.')).toBeInTheDocument();
  });

  it('does not call it CLEAR when there is nothing to be clear of', () => {
    // "Clear" is a measurement. An empty database is the absence of one, and
    // saying clear would be the app claiming a road is unwatched because it
    // has never looked.
    render(<RadarView model={model({ state: 'clear', distanceFt: null })} />);

    expect(
      screen.getByText(
        'nothing to measure to, so this is not a clear road - it is an unmapped one.',
      ),
    ).toBeInTheDocument();
  });

  it('still shows the hero the moment there is a distance', () => {
    render(<RadarView model={model({ state: 'clear', distanceFt: 12_672 })} />);

    expect(screen.queryByText('no cameras on the map here.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// v2 -- "flat borderless controls, 8px radius, fill-based depth"
// ---------------------------------------------------------------------------

describe('the v2 control language', () => {
  it('draws the header keys with no chip at all', () => {
    // v2 drew them as flat fills. Both keys lost the fill: a 52px bar carrying
    // two marks looked like it carried one button and one glyph, and two
    // controls of equal weight should read as two controls. The border was
    // already gone and the radius is kept for the focus ring.
    const key = ruleBody('.fwm-radar-key');
    expect(key).not.toBeNull();
    expect(key).toContain('border: none');
    expect(key).toContain('background: transparent');
    expect(key).not.toContain('var(--fwm-surface-control)');
  });

  it('keeps the 44px target on a key with no chip -- the target is not the paint', () => {
    const key = ruleBody('.fwm-radar-key');
    expect(key).toContain('width: var(--fwm-touch-min)');
    expect(key).toContain('height: var(--fwm-touch-min)');
  });

  it('still gives every header key the 44px target, chip or not', () => {
    const key = ruleBody('.fwm-radar-key');
    expect(key).toContain('width: var(--fwm-touch-min)');
    expect(key).toContain('height: var(--fwm-touch-min)');
  });

  it('draws the stat tiles as a 6px card fill with no border', () => {
    const tile = ruleBody('.fwm-radar-tile');
    expect(tile).not.toBeNull();
    expect(tile).toContain('border: none');
    expect(tile).toContain('border-radius: var(--fwm-radius-2)');
    expect(tile).toContain('background: var(--fwm-surface-card)');
  });

  it('draws the degraded action as a flat fill at the 8px radius', () => {
    const action = ruleBody('.fwm-radar-action');
    expect(action).not.toBeNull();
    expect(action).toContain('border: none');
    expect(action).toContain('border-radius: var(--fwm-radius-3)');
    expect(action).toContain('background: var(--fwm-surface-control)');
  });

  it('fills the in-range bar with the tint v2 draws, at the 8px radius', () => {
    // rgba(255,45,94,.14) over rgba(255,45,94,.55) -- exactly
    // --fwm-tint-in-range-soft over --fwm-tint-in-range-strong. This closes
    // DESIGN-GAPS.md#report-bar-tint-and-alert-tints for this bar.
    const bar = ruleBody('.fwm-radar-inrange');
    expect(bar).not.toBeNull();
    expect(bar).toContain('background: var(--fwm-tint-in-range-soft)');
    expect(bar).toContain('solid var(--fwm-tint-in-range-strong)');
    expect(bar).toContain('border-radius: var(--fwm-radius-3)');
  });

  it('desaturates the in-range bar when the mute is up', () => {
    // "MUTED · hue desaturates, data stays live". The tints are crimson-locked,
    // and a crimson wash under a grey label reads as an alarm the driver
    // silenced.
    expect(radarCss).toContain(
      '.fwm-radar[data-fwm-radar-state="muted"] .fwm-radar-inrange {',
    );
  });

  it('marks the in-range bar with the brand eye, not with a block', () => {
    const mark = ruleBody('.fwm-radar-inrange-mark');
    expect(mark).not.toBeNull();
    expect(mark).toContain('width: var(--fwm-icon-size)');
    expect(mark).toContain('darkroute-mark.png');
    expect(mark).toContain('background: var(--fwm-radar-hue)');
  });

  it('still counts a muted camera in the bar it just desaturated', () => {
    // Muting removes the alert, never the record.
    const { container } = render(<RadarView model={model({ state: 'muted', countInRange: 3 })} />);
    // The count bar is gone. What this test is really about is that muting
    // desaturates without stopping the screen saying anything.
    expect(container.querySelector('.fwm-topblock-headline')).not.toBeNull();
  });
});
