/**
 * The INTEL CARD, state by state, against what the design draws.
 *
 * Reference: `Flockys Screens II.dc.html` -- `A4 · INTEL CARD - MODAL FROM
 * SWEEP` and `B9 · RECORD FLAGS - WHERE IT SURFACES`.
 *
 * `intel.css` is pulled in as text so the rules the tests care about -- the
 * absence of `:hover`, and the fact that a flagged operator never re-colours
 * the card -- can be asserted. vitest runs with `css: false`, so a computed
 * style would be empty and asserting on one would prove nothing.
 */

// `intel.css` is READ FROM DISK, not imported. vitest runs with `css: false`,
// which stubs every CSS import -- `?raw` included -- to an empty string, so an
// assertion against the import would pass on '' no matter what the file says.
// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CameraAssessment, CameraRecord } from '../../../stores';
import { NO_VALUE } from '../../radar';
import { READ_WINDOW_DAYS, intelFact, intelModel } from '../intelState.ts';
import type { IntelInput, IntelViewModel } from '../intelState.ts';

import { IntelView, NO_CAMERA_NOTE } from './IntelView.tsx';
import { PHOTO_OFF_NOTE } from './IntelPhoto.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const intelCss: string = readFileSync(`${HERE}/../intel.css`, 'utf8');
/** Rules only. The file's prose explains why there is no hover state, using the word. */
const intelRules: string = intelCss.replace(/\/\*[\s\S]*?\*\//g, '');

interface CssRule {
  readonly selector: string;
  readonly body: string;
}

/**
 * The stylesheet split into `{ selector, body }`.
 *
 * The tests below assert things ABOUT rules -- "no muted selector hides
 * anything", "only a state selector sets the hue". A substring search over the
 * whole file cannot express either, and a `not.toContain` passes just as
 * happily against a file that was never read. Every test that uses this also
 * asserts a POSITIVE count first, so an empty or unreadable `intel.css` fails
 * it rather than sailing through.
 */
function cssRules(): readonly CssRule[] {
  const rules: CssRule[] = [];
  for (const chunk of intelRules.split('}')) {
    const brace = chunk.indexOf('{');
    if (brace === -1) continue;
    rules.push({ selector: chunk.slice(0, brace).trim(), body: chunk.slice(brace + 1) });
  }
  return rules;
}

const CSS_RULES = cssRules();

/** The source of the component under test, for the assertions about imports. */
const photoSource: string = readFileSync(`${HERE}/IntelPhoto.tsx`, 'utf8');

function record(over: Partial<CameraRecord> = {}): CameraRecord {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    directionDeg: 223,
    ownerType: 'hoa',
    confirmations: 28,
    ...over,
  };
}

function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 223,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 223,
    inRange: true,
    muted: false,
    mergedIds: ['FWM-0442'],
    ...over,
  };
}

function model(over: Partial<IntelInput> = {}): IntelViewModel {
  const input: IntelInput = {
    cameraId: 'FWM-0442',
    record: record(),
    assessment: assessment(),
    state: 'in_range',
    mutedCamera: false,
    muteRemainingMs: 0,
    reads: 21,
    windowDays: READ_WINDOW_DAYS,
    operatorRecord: null,
    photoAvailable: false,
    ...over,
  };
  return intelModel(input);
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.fwm-intel');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

// ---------------------------------------------------------------------------
// The panel, element by element
// ---------------------------------------------------------------------------

describe('what A4 draws', () => {
  it('is a modal, and says so to a screen reader', () => {
    const { container } = render(<IntelView model={model()} />);
    const dialog = screen.getByRole('dialog', { name: 'camera intel' });
    expect(dialog).toBe(root(container));
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('renders the id in the title slot and the authored note under it', () => {
    // NOT an em dash: `CameraRecord` carries no hardware name and no place, and
    // an em dash in the 22px title is honest and unreadable. The id is the only
    // identifier this build always has, so it is promoted -- once -- and the
    // line below carries the note that says why it is there.
    const { container } = render(<IntelView model={model()} />);
    expect(container.querySelector('.fwm-intel-title')?.textContent).toBe('FWM-0442');
    expect(container.querySelector('[data-fwm-intel-subline="note"]')?.textContent).toBe(
      'NO HARDWARE OR PLACE NAME ON THIS RECORD',
    );
    expect(container.querySelector('.fwm-intel-title')?.textContent).not.toContain(NO_VALUE);
  });

  it('renders the identity, the readout and the three tiles', () => {
    const { container } = render(<IntelView model={model()} />);

    expect(container.querySelector('[data-fwm-intel-readout="true"]')?.textContent).toBe(
      '425 FT · SW',
    );
    expect(container.querySelector('[data-fwm-intel-tile="OWNER"]')?.textContent).toContain('HOA');
    expect(container.querySelector('[data-fwm-intel-tile="FACING"]')?.textContent).toContain(
      '223°',
    );
    expect(container.querySelector('[data-fwm-intel-tile="MOUNT"]')?.textContent).toContain(
      NO_VALUE,
    );
  });

  it('renders every fact row in the drawn order', () => {
    const { container } = render(<IntelView model={model()} />);
    const labels = [...container.querySelectorAll('[data-fwm-intel-fact]')].map((row) =>
      row.getAttribute('data-fwm-intel-fact'),
    );
    expect(labels).toEqual([
      'EFF ATLAS',
      'INTER-AGENCY SHARING',
      'FIRST REPORTED',
      'IN THIS COUNTY',
      'CONFIRMED BY',
      'COVERS',
      'YOUR READS',
      // How old the record is. Added last on purpose: it is a caveat on every
      // row above it, and a caveat reads after the claim.
      'DATA AS OF',
    ]);
  });

  it('draws the four actions with the panel copy', () => {
    render(<IntelView model={model()} />);
    expect(screen.getByRole('button', { name: 'CONFIRM STILL THERE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DISPUTE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SHARE' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Honest absences
// ---------------------------------------------------------------------------

describe('what it will not make up', () => {
  it('never renders a cross-reference, a sharing status or a first-reported date', () => {
    const { container } = render(<IntelView model={model()} />);
    for (const label of ['EFF ATLAS', 'INTER-AGENCY SHARING', 'FIRST REPORTED']) {
      const row = container.querySelector(`[data-fwm-intel-fact="${label}"]`);
      expect(row?.getAttribute('data-fwm-intel-known')).toBe('false');
      expect(row?.textContent).toContain(NO_VALUE);
    }
    expect(container.textContent).not.toContain('CROSS-REFERENCED');
    expect(container.textContent).not.toContain('AGENCIES');
  });

  it('says which camera is missing instead of drawing an empty card', () => {
    render(<IntelView model={null} />);
    expect(screen.getByText(NO_CAMERA_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CONFIRM STILL THERE' })).toBeNull();
  });

  it('shows an em dash rather than a distance when the engine has not assessed the camera', () => {
    const { container } = render(<IntelView model={model({ assessment: null, state: 'clear' })} />);
    expect(container.querySelector('[data-fwm-intel-readout="true"]')?.textContent).toBe(
      `${NO_VALUE} FT`,
    );
  });

  it('draws the photo drop, disabled, with the reason under it', () => {
    render(<IntelView model={model()} />);
    const drop = screen.getByRole('button', { name: /DROP PHOTO OF CAMERA/ });
    expect(drop).toBeDisabled();
    expect(screen.getByText(PHOTO_OFF_NOTE)).toBeInTheDocument();
  });

  it('takes the shared refusal copy through REPORT own barrel, not a deep path', () => {
    // The string is REPORT's and is reused rather than re-authored -- two
    // screens explaining one rule in two sentences is worse. `features/report`
    // exports it from `index.ts`; reaching past that into a component file
    // makes another feature's internals this file's business, and every other
    // cross-feature import here (`../radar`, `../log`) goes through a barrel.
    expect(photoSource).toContain("from '../../report'");
    expect(photoSource).not.toContain('report/components/');
  });
});

describe('the fact rows carry the panel colours', () => {
  it('marks each value with the tone the panel draws it in', () => {
    const filled: IntelViewModel = {
      ...model(),
      facts: [
        intelFact('EFF ATLAS', 'CROSS-REFERENCED'),
        intelFact('INTER-AGENCY SHARING', 'YES · 412 AGENCIES'),
        intelFact('FIRST REPORTED', 'MAR 2026'),
        intelFact('CONFIRMED BY', '28 HAKCERS'),
        intelFact('YOUR READS', '21 THIS SESSION'),
      ],
    };
    const { container } = render(<IntelView model={filled} />);
    const tone = (label: string): string | null =>
      container
        .querySelector(`[data-fwm-intel-fact="${label}"] .fwm-intel-fact-value`)
        ?.getAttribute('data-fwm-intel-tone') ?? null;

    expect(tone('EFF ATLAS')).toBe('clear');
    expect(tone('INTER-AGENCY SHARING')).toBe('alert');
    expect(tone('FIRST REPORTED')).toBe('default');
    expect(tone('YOUR READS')).toBe('alert');
    // And the stylesheet has somewhere to put each of them.
    expect(intelRules).toContain('[data-fwm-intel-tone="clear"]');
    expect(intelRules).toContain('[data-fwm-intel-tone="alert"]');
  });
});

// ---------------------------------------------------------------------------
// B9 -- the flag colours the operator, not the camera
// ---------------------------------------------------------------------------

describe('the flagged-operator variant', () => {
  it('draws the banner for a cited record, and still colours the card by state', () => {
    const flagged = model({
      operatorRecord: { agency: 'County sheriff', findings: 'a finding.', sources: 3 },
    });
    const { container } = render(<IntelView model={flagged} />);
    // `FEATURES.record` is on now: the condition it was gated behind -- every
    // entry carrying a citation -- is met and enforced by a build check.
    expect(screen.getByText('OPERATOR HAS A RECORD')).toBeInTheDocument();
    expect(root(container).getAttribute('data-fwm-intel-flagged')).toBe('true');
    // B9's rule, unchanged and now actually exercised: the flag colours the
    // OPERATOR, never the camera. A flagged agency's cameras still alert on
    // their own state.
    expect(root(container).getAttribute('data-fwm-intel-state')).toBe('in_range');
  });

  it('draws no banner for a record with no sources behind it', () => {
    // The line that matters most in this file. An accusation against a named
    // agency with nothing to cite is not a record, and it is never shown.
    const uncited = model({
      operatorRecord: { agency: 'County sheriff', findings: 'a finding.', sources: 0 },
    });
    const { container } = render(<IntelView model={uncited} />);
    expect(screen.queryByText('OPERATOR HAS A RECORD')).toBeNull();
    expect(root(container).getAttribute('data-fwm-intel-flagged')).toBe('false');
  });

  it('sets the card hue from the state and from nothing else', () => {
    // The whole B9 rule, enforced in CSS: the flag colours the operator, not
    // the camera, so a flagged agency's cams still alert normally. Asserted as
    // a positive -- every assignment of the hue, and where each one lives --
    // because `not.toContain('data-fwm-intel-flagged')` would pass against an
    // empty stylesheet and against one that never mentions the flag at all.
    const setsHue = CSS_RULES.filter((rule) => /--fwm-intel-hue:/.test(rule.body));
    // The fallback on `.fwm-intel`, plus one per state: clear, approaching,
    // in_range, multiple, muted, no_gps.
    expect(setsHue).toHaveLength(7);
    expect(setsHue[0]?.selector).toBe('.fwm-intel');
    for (const rule of setsHue.slice(1)) {
      expect(rule.selector).toMatch(/^\.fwm-intel\[data-fwm-intel-state="[a-z_]+"\]$/);
    }
    for (const rule of CSS_RULES) {
      expect(rule.selector).not.toContain('data-fwm-intel-flagged');
    }
  });

  it('draws the flagged banner in the destructive hue and nothing else in it', () => {
    const destructive = CSS_RULES.filter((rule) => rule.body.includes('--fwm-destructive'));
    expect(destructive.length).toBeGreaterThan(0);
    for (const rule of destructive) {
      // The banner, the DISPUTE key, and the failed-action note. Never the
      // card edge, the readout, a tile or the hue.
      expect(rule.selector).toMatch(/fwm-intel-(record|note|action)/);
    }
  });
});

// ---------------------------------------------------------------------------
// Muting
// ---------------------------------------------------------------------------

describe('a muted camera', () => {
  it('keeps every fact, tile and action, and only changes hue', () => {
    const loud = render(<IntelView model={model()} />);
    const loudFacts = [...loud.container.querySelectorAll('[data-fwm-intel-fact]')].map(
      (row) => row.textContent,
    );
    loud.unmount();

    const quiet = render(
      <IntelView
        model={model({ state: 'muted', mutedCamera: true, muteRemainingMs: 600_000 })}
      />,
    );
    const quietFacts = [...quiet.container.querySelectorAll('[data-fwm-intel-fact]')].map(
      (row) => row.textContent,
    );

    expect(quietFacts).toEqual(loudFacts);
    expect(root(quiet.container).getAttribute('data-fwm-intel-state')).toBe('muted');
    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not press the per-camera key because everything is muted', () => {
    const { container } = render(
      <IntelView model={model({ state: 'muted', mutedCamera: false })} />,
    );
    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // And no per-camera countdown either: nothing on this card is counting
    // down a mute this card did not set.
    expect(container.querySelector('[data-fwm-intel-note="mute"]')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The mute is a ten-minute timer, and the card draws the timer
  // -------------------------------------------------------------------------

  it('draws how long the silence lasts, so a lapsing mute is not drawn as a latch', () => {
    const { container } = render(
      <IntelView model={model({ state: 'muted', mutedCamera: true, muteRemainingMs: 492_000 })} />,
    );
    const line = container.querySelector('[data-fwm-intel-note="mute"]');
    expect(line?.textContent).toBe('MUTED 8:12 · STILL DRAWN, STILL COUNTED');
    // The clock half takes the amber the design draws `MUTED 8:12` in; the
    // sentence beside it stays in the note idiom.
    expect(line?.querySelector('.fwm-intel-mute-clock')?.textContent).toBe('MUTED 8:12');
    expect(CSS_RULES.find((rule) => rule.selector === '.fwm-intel-mute-clock')?.body).toContain(
      'var(--fwm-alert-approaching)',
    );
  });

  it('stops drawing the countdown the moment the timer runs out', () => {
    const { container } = render(
      <IntelView model={model({ state: 'muted', mutedCamera: true, muteRemainingMs: 0 })} />,
    );
    expect(container.querySelector('[data-fwm-intel-note="mute"]')).toBeNull();
    expect(container.textContent).not.toContain('MUTED 0:00');
  });
});

// ---------------------------------------------------------------------------
// The controls
// ---------------------------------------------------------------------------

describe('the controls', () => {
  it('dismisses from the grabber and from the scrim, the two affordances drawn', () => {
    const onDismiss = vi.fn();
    render(<IntelView model={model()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'close intel card' }));
    fireEvent.click(screen.getByRole('button', { name: 'dismiss intel card' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('renders the grabber as a pill rather than a dead button when nothing can close it', () => {
    const { container } = render(<IntelView model={model()} />);
    expect(container.querySelector('[data-fwm-intel-grabber="static"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'close intel card' })).toBeNull();
  });

  it('copies the camera id from the line the id is drawn on', () => {
    const onCopyId = vi.fn();
    render(<IntelView model={model()} onCopyId={onCopyId} />);
    fireEvent.click(screen.getByRole('button', { name: 'copy camera id FWM-0442' }));
    expect(onCopyId).toHaveBeenCalledTimes(1);
  });

  it('disables a key with nothing wired to it rather than leaving it live and inert', () => {
    render(<IntelView model={model()} />);
    expect(screen.getByRole('button', { name: 'CONFIRM STILL THERE' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SHARE' })).toBeDisabled();
  });

  it('holds both statements while a queue write is in flight', () => {
    render(<IntelView model={model()} busy onConfirm={vi.fn()} onDispute={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'CONFIRM STILL THERE' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DISPUTE' })).toBeDisabled();
  });

  it('reports what an action did, because the panel draws no feedback', () => {
    render(<IntelView model={model()} outcome="confirm-queued" />);
    expect(screen.getByRole('status')).toHaveTextContent('CONFIRMATION QUEUED');
  });
});

// ---------------------------------------------------------------------------
// `aria-modal="true"` is a promise about focus, so it is kept
// ---------------------------------------------------------------------------

describe('the modal keeps its aria-modal promise', () => {
  it('reaches the camera before it reaches the dismiss', () => {
    // The scrim is a full-bleed dismiss button. Drawn first, it would be the
    // first tab stop and the first thing announced inside the dialog: a screen
    // reader would open the card on "dismiss intel card".
    const { container } = render(<IntelView model={model()} onDismiss={vi.fn()} />);
    const stops = [...container.querySelectorAll('button')];
    expect(stops[0]?.getAttribute('aria-label')).toBe('close intel card');
    expect(stops[stops.length - 1]?.getAttribute('aria-label')).toBe('dismiss intel card');

    const card = container.querySelector('.fwm-intel-card');
    const scrim = container.querySelector('.fwm-intel-scrim');
    expect(card?.compareDocumentPosition(scrim as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('moves focus into the dialog when it opens', () => {
    const { container } = render(<IntelView model={model()} onDismiss={vi.fn()} />);
    expect(document.activeElement).toBe(container.querySelector('.fwm-intel-card'));
  });

  it('does not let Tab walk out of a dialog that claims the rest is inert', () => {
    const { container } = render(
      <IntelView model={model()} onDismiss={vi.fn()} onConfirm={vi.fn()} />,
    );
    const stops = [...container.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const first = stops[0];
    const last = stops[stops.length - 1];
    expect(first).toBeDefined();
    expect(last).not.toBe(first);

    last?.focus();
    fireEvent.keyDown(last as HTMLElement, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape, which is the keyboard version of the scrim tap', () => {
    const onDismiss = vi.fn();
    const { container } = render(<IntelView model={model()} onDismiss={onDismiss} />);
    fireEvent.keyDown(container.querySelector('.fwm-intel-card') as HTMLElement, {
      key: 'Escape',
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not pretend Escape closes a card nothing can close', () => {
    const { container } = render(<IntelView model={model()} />);
    // No handler wired: the key does nothing rather than throwing, and focus
    // stays where it is.
    fireEvent.keyDown(container.querySelector('.fwm-intel-card') as HTMLElement, {
      key: 'Escape',
    });
    expect(container.querySelector('.fwm-intel-card')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

describe('intel.css', () => {
  it('was actually read, so the assertions below are about something', () => {
    // Every negative assertion in this block passes against an empty string.
    // This is the one that does not.
    expect(CSS_RULES.length).toBeGreaterThan(20);
    expect(CSS_RULES.map((rule) => rule.selector)).toContain('.fwm-intel-card');
    expect(CSS_RULES.map((rule) => rule.selector)).toContain('.fwm-intel-scrim');
  });

  it('has no hover state: a pointer hover never fires on a phone in a car mount', () => {
    expect(CSS_RULES.length).toBeGreaterThan(20);
    for (const rule of CSS_RULES) expect(rule.selector).not.toContain(':hover');
  });

  it('carries every colour as a token', () => {
    // The design-value checker enforces this repo-wide; this keeps the failure
    // local to the file that broke it.
    const coloured = CSS_RULES.filter((rule) => /(?:^|[^-])color:|background/.test(rule.body));
    expect(coloured.length).toBeGreaterThan(10);
    for (const rule of coloured) {
      expect(rule.body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule.body).not.toMatch(/\brgba?\(/);
    }
  });

  it('does not hide, collapse or dim anything because a camera is muted', () => {
    // "Muting only removes the alert -- never the record."
    const muted = CSS_RULES.filter((rule) => rule.selector.includes('data-fwm-intel-muted'));
    expect(muted).toHaveLength(1);
    expect(muted[0]?.selector).toBe('.fwm-intel-action[data-fwm-intel-muted="true"]');
    for (const rule of muted) {
      for (const banned of ['display', 'visibility', 'opacity', 'height', 'content-visibility']) {
        expect(rule.body).not.toContain(banned);
      }
    }
    // And no muted rule anywhere gives the key an alert hue: a lit-up mute key
    // reads as an alarm.
    expect(muted[0]?.body).not.toContain('--fwm-alert');
  });

  it('gives the primary key the drawn fill in every state, not the alert hue', () => {
    // A4 draws `CONFIRM STILL THERE` #FF2D5E with a black label. Hue-driven,
    // it would ship GREEN on a clear camera -- in a system where green means
    // "nothing near you" -- and black-on-#3A3F4B under no_gps, which is 2:1.
    const confirm = CSS_RULES.filter((rule) =>
      rule.selector.includes('data-fwm-intel-action="confirm"'),
    );
    expect(confirm).toHaveLength(1);
    expect(confirm[0]?.body).toContain('background: var(--fwm-alert-in-range)');
    expect(confirm[0]?.body).not.toContain('--fwm-intel-hue');
  });

  it('keeps the card above the scrim now that the scrim is drawn after it', () => {
    const card = CSS_RULES.find((rule) => rule.selector === '.fwm-intel-card');
    expect(card?.body).toContain('z-index: 1');
  });
});
