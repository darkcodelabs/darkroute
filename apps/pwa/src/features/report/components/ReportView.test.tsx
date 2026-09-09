/**
 * Every state of the REPORT sheet, rendered one at a time, against what the
 * design draws.
 *
 * Reference: `Flockys App Screens v2.dc.html` -- `06 · REPORT - SHEET FROM THE
 * DOCK KEY` (the header and its `✕`, the two-half toggle, `POSITION · AUTO`,
 * `FACING · FROM COMPASS` with `SW` and `TAP ARC TO ADJUST`, the `PHOTO` and
 * `MAKE / MODEL` keys, the four mount chips, the queue line, `SUBMIT REPORT`
 * and the hold hint).
 *
 * `report.css` is pulled in as TEXT so the rules the tests care about -- the
 * absence of `:hover`, the hidden empty status line -- can be asserted. vitest
 * runs with `css: false`, so a computed style would be empty and asserting on
 * one would prove nothing.
 */

// `report.css` is READ FROM DISK, not imported, for the reason above.
// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DIAL_UNITS, FACING_MAX_DEG, FACING_MIN_DEG } from '../facing.ts';
import { emptyDraft, withFacing, withMakeModel, withMount } from '../reportDraft.ts';
import type { ReportDraft } from '../reportDraft.ts';

import { PHOTO_OFF_NOTE } from './DetailTiles.tsx';
import { REPORT_TITLE, ReportView } from './ReportView.tsx';
import type { ReportViewModel } from './ReportView.tsx';
import { HOLD_HINT, SUBMIT_LABEL } from './SubmitBlock.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const reportCss: string = readFileSync(`${HERE}/../report.css`, 'utf8');
/** Rules only. The file's prose explains why there is no hover state, using the word. */
const reportRules: string = reportCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The sheet as the panel draws it: a lock in Cincinnati, facing SW. */
function model(over: Partial<ReportViewModel> = {}): ReportViewModel {
  const draft: ReportDraft = over.draft ?? withFacing(emptyDraft(), 223);
  return {
    coordinates: '39.0997 N · 84.5786 W',
    positionDetail: '±4 M · 9 SATS',
    hasFix: true,
    facingLabel: 'FACING · FROM COMPASS',
    cameraId: null,
    // Nothing nearby, matching `cameraId: null` above. These two are separate
    // fields on purpose - see `ReportViewModel` - and a fixture that let them
    // drift would be asserting against a state the app cannot produce.
    canConfirm: false,
    cameraMuted: false,
    photoAvailable: false,
    // The state the sheet opens in. v0 draws no attach affordance at all - the
    // photo path is v1's - so this fixture never leaves `none`.
    photo: { state: 'none' },
    makeModelIssue: null,
    status: { tone: 'queued', text: '2 REPORTS QUEUED · SYNC ON WIFI' },
    submitDisabled: false,
    // Nothing said yet about where the camera was, which is the state the sheet
    // opens in and the state that keeps a report unpublishable.
    side: null,
    offsetFt: null,
    hasHeading: true,
    whereSummary: null,
    ...over,
    draft,
  };
}

/** jsdom lays nothing out, so the dial is told how big it is. */
function measureDial(element: Element): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: DIAL_UNITS,
    height: DIAL_UNITS,
    right: DIAL_UNITS,
    bottom: DIAL_UNITS,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('the panel the design draws', () => {
  it('renders the header, the toggle, both cards, both tiles, the chips and the button', () => {
    // Wired, because the panel draws the live sheet: an unwired control is a
    // separate state, asserted in "renders every control inert" below.
    render(<ReportView model={model()} onAdjustFacing={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'REPORT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NEW CAMERA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CONFIRM EXISTING' })).toBeInTheDocument();

    expect(screen.getByText('POSITION · AUTO')).toBeInTheDocument();
    expect(screen.getByText('39.0997 N · 84.5786 W')).toBeInTheDocument();
    expect(screen.getByText('±4 M · 9 SATS')).toBeInTheDocument();

    expect(screen.getByText('FACING · FROM COMPASS')).toBeInTheDocument();
    expect(screen.getByText('SW')).toBeInTheDocument();
    expect(screen.getByText(/223° · covering the northbound lane/)).toBeInTheDocument();
    expect(screen.getByText('TAP ARC TO ADJUST')).toBeInTheDocument();

    expect(screen.getByText('MAKE / MODEL')).toBeInTheDocument();
    for (const chip of ['POLE MOUNT', 'SOLAR', 'TRAILER', 'UNSURE']) {
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument();
    }

    expect(screen.getByText('2 REPORTS QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeEnabled();
    expect(screen.getByText(HOLD_HINT)).toBeInTheDocument();
  });

  it('presses the half of the toggle the report is in', () => {
    render(<ReportView model={model({ draft: emptyDraft('confirm'), cameraId: 'FWM-0442' })} />);

    expect(screen.getByRole('button', { name: 'CONFIRM EXISTING' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'NEW CAMERA' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('presses one mount chip at a time', () => {
    render(<ReportView model={model({ draft: withMount(emptyDraft(), 'pole') })} />);

    expect(screen.getByRole('button', { name: 'POLE MOUNT' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'UNSURE' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the facing arc', () => {
  it('adjusts to the bearing a tap points at', () => {
    const onAdjustFacing = vi.fn();
    render(<ReportView model={model()} onAdjustFacing={onAdjustFacing} />);

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    measureDial(dial);
    // Due east of the centre of a 120px dial.
    fireEvent.click(dial, { clientX: 120, clientY: 60 });

    expect(onAdjustFacing).toHaveBeenCalledWith(90);
  });

  it('leaves the bearing alone when the tap cannot be read', () => {
    const onAdjustFacing = vi.fn();
    render(<ReportView model={model()} onAdjustFacing={onAdjustFacing} />);

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    measureDial(dial);
    fireEvent.click(dial, { clientX: 60, clientY: 60 });

    expect(onAdjustFacing).not.toHaveBeenCalled();
  });

  it('is adjustable from a keyboard, not only from a thumb', () => {
    const onAdjustFacing = vi.fn();
    render(<ReportView model={model()} onAdjustFacing={onAdjustFacing} />);

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    fireEvent.keyDown(dial, { key: 'ArrowRight' });
    expect(onAdjustFacing).toHaveBeenCalledWith(224);

    fireEvent.keyDown(dial, { key: 'PageDown' });
    expect(onAdjustFacing).toHaveBeenCalledWith(208);
  });

  it('announces the bearing, and says so when there is none', () => {
    const { rerender } = render(<ReportView model={model()} onAdjustFacing={vi.fn()} />);
    expect(screen.getByRole('slider', { name: 'camera facing' })).toHaveAttribute(
      'aria-valuetext',
      'SW, 223 degrees',
    );

    rerender(
      <ReportView
        model={model({ draft: emptyDraft(), facingLabel: 'FACING · NO COMPASS' })}
        onAdjustFacing={vi.fn()}
      />,
    );
    expect(screen.getByRole('slider', { name: 'camera facing' })).toHaveAttribute(
      'aria-valuetext',
      'not set',
    );
    expect(screen.getByText('FACING · NO COMPASS')).toBeInTheDocument();
  });

  it('reports no NUMBER at all when it has no bearing, only that it is not set', () => {
    const { rerender } = render(
      <ReportView
        model={model({ draft: emptyDraft(), facingLabel: 'FACING · NO COMPASS' })}
        onAdjustFacing={vi.fn()}
      />,
    );

    const unset = screen.getByRole('slider', { name: 'camera facing' });
    // A screen reader that prefers `aria-valuenow` would otherwise announce
    // "0" -- due north -- for a bearing the app does not have.
    expect(unset).not.toHaveAttribute('aria-valuenow');
    expect(unset).toHaveAttribute('aria-valuetext', 'not set');
    expect(unset).toHaveAttribute('aria-valuemin', String(FACING_MIN_DEG));
    expect(unset).toHaveAttribute('aria-valuemax', String(FACING_MAX_DEG));

    rerender(<ReportView model={model()} onAdjustFacing={vi.fn()} />);
    expect(screen.getByRole('slider', { name: 'camera facing' })).toHaveAttribute(
      'aria-valuenow',
      '223',
    );
  });

  it('never reports a value above the maximum it declares', () => {
    // `bearingFromPoint` returns three decimals: a tap a hair west of north
    // reads 359.x, which rounds to 360 -- one degree past `aria-valuemax`.
    render(
      <ReportView
        model={model({ draft: withFacing(emptyDraft(), 359.7) })}
        onAdjustFacing={vi.fn()}
      />,
    );

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    const now = Number(dial.getAttribute('aria-valuenow'));
    expect(now).toBeLessThanOrEqual(FACING_MAX_DEG);
    expect(now).toBeGreaterThanOrEqual(FACING_MIN_DEG);
    // And the two announcements agree with each other.
    expect(dial).toHaveAttribute('aria-valuetext', `N, ${String(now)} degrees`);
  });

  it('draws no wedge at all when nothing has supplied a bearing', () => {
    const { container } = render(<ReportView model={model({ draft: emptyDraft() })} />);
    expect(container.querySelector('.fwm-report-dial-wedge')).toBeNull();
    expect(container.querySelector('[data-fwm-report-facing]')).toHaveAttribute(
      'data-fwm-report-facing',
      'unset',
    );
  });
});

describe('states the design never drew', () => {
  it('says there is no fix instead of rendering coordinates it does not have', () => {
    render(
      <ReportView
        model={model({
          coordinates: '—',
          positionDetail: null,
          hasFix: false,
          status: { tone: 'blocked', text: 'NO POSITION FIX · A REPORT NEEDS ONE' },
          submitDisabled: true,
        })}
      />,
    );

    expect(screen.getByText('NO FIX')).toBeInTheDocument();
    expect(screen.getByText('NO POSITION FIX · A REPORT NEEDS ONE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeDisabled();
  });

  it('draws no status line when the queue is empty and nothing is blocking', () => {
    const { container } = render(<ReportView model={model({ status: null })} />);
    const line = container.querySelector('[data-fwm-report-status]');
    expect(line).toHaveAttribute('data-fwm-report-status', 'none');
    expect(line?.textContent).toBe('');
    expect(reportRules).toContain('[data-fwm-report-status="none"]');
  });

  it('keeps the receipt live region mounted and unhidden while it is empty', () => {
    // THE RECEIPT IS THE ONLY FEEDBACK A SUCCESSFUL SUBMIT PRODUCES: the panel
    // draws no confirmation. A live region that transitions out of
    // `display:none` -- or `visibility:hidden`, or unmounting -- is announced
    // unreliably across assistive tech, so the first `1 REPORT QUEUED` could be
    // silent to a non-visual user. It draws nothing because it CONTAINS
    // nothing, not because it is hidden.
    const { container, rerender } = render(<ReportView model={model({ status: null })} />);
    const empty = container.querySelector('[data-fwm-report-status]');
    expect(empty).toHaveAttribute('role', 'status');
    expect(empty).toHaveAttribute('aria-live', 'polite');

    const rule = /\.fwm-report-status\[data-fwm-report-status="none"\]\s*\{([^}]*)\}/.exec(
      reportRules,
    );
    expect(rule).not.toBeNull();
    expect(rule?.[1]).not.toMatch(/display\s*:\s*none/);
    expect(rule?.[1]).not.toMatch(/visibility\s*:\s*hidden/);
    expect(rule?.[1]).not.toMatch(/content-visibility/);

    // And it is the SAME element once the receipt arrives, not a new one.
    rerender(
      <ReportView model={model({ status: { tone: 'queued', text: '1 REPORT QUEUED' } })} />,
    );
    expect(container.querySelector('[data-fwm-report-status]')).toBe(empty);
    expect(empty?.textContent).toContain('1 REPORT QUEUED');
  });

  it('refuses the photo tile and says why, rather than offering a dead control', () => {
    render(<ReportView model={model()} />);

    const photo = screen.getByRole('button', { name: `PHOTO - ${PHOTO_OFF_NOTE}` });
    expect(photo).toBeDisabled();
    expect(photo).toHaveAttribute('data-fwm-report-capture', 'unavailable');
    expect(screen.getByText(PHOTO_OFF_NOTE)).toBeInTheDocument();
  });

  it('marks a plate-shaped make and model invalid and blocks the submit', () => {
    render(
      <ReportView
        model={model({
          draft: withMakeModel(emptyDraft(), 'HVK 8842'),
          makeModelIssue: 'plate-shaped',
          status: { tone: 'blocked', text: 'MAKE / MODEL LOOKS LIKE A PLATE · NOT QUEUED' },
          submitDisabled: true,
        })}
      />,
    );

    const field = screen.getByLabelText('MAKE / MODEL');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('data-fwm-report-make-model', 'plate-shaped');
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeDisabled();
  });

  it('opens the make and model field on demand, and keeps a value it already has', () => {
    const { rerender } = render(<ReportView model={model()} onMakeModelChange={vi.fn()} />);
    expect(screen.queryByLabelText('MAKE / MODEL')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'MAKE / MODEL' }));
    expect(screen.getByLabelText('MAKE / MODEL')).toBeInTheDocument();

    rerender(
      <ReportView
        model={model({ draft: withMakeModel(emptyDraft(), 'Flock Falcon') })}
        onMakeModelChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('MAKE / MODEL')).toHaveValue('Flock Falcon');
  });
});

describe('a muted camera is still a camera', () => {
  it('names it, marks it muted, and still offers the confirmation', () => {
    const { container } = render(
      <ReportView
        model={model({
          draft: emptyDraft('confirm'),
          cameraId: 'FWM-0442',
          cameraMuted: true,
          positionDetail: '±4 M · 9 SATS · FWM-0442',
        })}
        onSubmit={vi.fn()}
      />,
    );

    const sheet = container.querySelector('.fwm-report');
    expect(sheet).toHaveAttribute('data-fwm-report-camera', 'FWM-0442');
    expect(sheet).toHaveAttribute('data-fwm-report-muted', 'true');
    expect(screen.getByText('±4 M · 9 SATS · FWM-0442')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeEnabled();
  });
});

describe('handlers', () => {
  it('reports the mode, the mount, the text and the press to its owner', () => {
    const onSelectMode = vi.fn();
    const onToggleMount = vi.fn();
    const onMakeModelChange = vi.fn();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(
      <ReportView
        model={model()}
        onSelectMode={onSelectMode}
        onToggleMount={onToggleMount}
        onMakeModelChange={onMakeModelChange}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM EXISTING' }));
    expect(onSelectMode).toHaveBeenCalledWith('confirm');

    fireEvent.click(screen.getByRole('button', { name: 'SOLAR' }));
    expect(onToggleMount).toHaveBeenCalledWith('solar');

    fireEvent.click(screen.getByRole('button', { name: 'MAKE / MODEL' }));
    fireEvent.change(screen.getByLabelText('MAKE / MODEL'), {
      target: { value: 'Flock Falcon' },
    });
    expect(onMakeModelChange).toHaveBeenCalledWith('Flock Falcon');

    fireEvent.click(screen.getByRole('button', { name: SUBMIT_LABEL }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders every control inert rather than fake when nothing is wired', () => {
    render(<ReportView model={model()} />);

    expect(screen.getByRole('button', { name: 'close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NEW CAMERA' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'UNSURE' })).toBeDisabled();
    expect(screen.getByRole('button', { name: SUBMIT_LABEL })).toBeDisabled();
    // No adjust handler means the dial is a picture, not a slider.
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('img', { name: 'camera facing' })).toBeInTheDocument();
    expect(screen.queryByText('TAP ARC TO ADJUST')).toBeNull();
  });
});

describe('the v2 redesign', () => {
  it('heads the sheet REPORT, not REPORT CAMERA: the word went away with the bar', () => {
    render(<ReportView model={model()} />);

    expect(REPORT_TITLE).toBe('REPORT');
    expect(screen.getByRole('heading', { name: 'REPORT' })).toBeInTheDocument();
    // `CAMERA` belonged to the crimson bar that v1 put on every screen. v2
    // deleted that bar into the dock, so the word is gone from the heading too.
    expect(screen.queryByRole('heading', { name: 'REPORT CAMERA' })).toBeNull();
  });

  it('offers no way to raise itself, because the dock key is the only entry point', () => {
    // v1 drew a persistent `REPORT CAMERA / 2 QUEUED` bar. If one ever comes
    // back INSIDE the sheet -- a self-referential control, or a queue count
    // that is a button rather than the live region -- this fails.
    render(<ReportView model={model()} onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^REPORT$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /QUEUED/ })).toBeNull();
    expect(screen.getByText('2 REPORTS QUEUED · SYNC ON WIFI').closest('button')).toBeNull();
  });

  it('still says the dock key drops a pin, in v2 words, and does not implement it', () => {
    // The hint is v2's own sentence about the DOCK KEY's 1s hold. The sheet
    // renders it because v2 renders it here; the gesture lives in the dock.
    render(<ReportView model={model()} onSubmit={vi.fn()} />);

    expect(HOLD_HINT).toBe('HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN');
    expect(screen.getByText(HOLD_HINT).closest('button')).toBeNull();
  });

  it('draws flat: no control on the sheet carries a line token any more', () => {
    // "v2 - flat borderless controls, 8px radius, fill-based depth". v1 edged
    // the toggle and the POSITION card in --fwm-line and the tiles, the field
    // and the chips in --fwm-line-strong. v2 draws none of them.
    expect(reportRules).not.toContain('--fwm-line-strong');
    expect(reportRules).not.toContain('var(--fwm-line)');
  });

  it('draws depth with the v2 fill ladder instead', () => {
    // Each of the three fills v2 introduced does a job the deleted edges did.
    expect(reportRules).toContain('var(--fwm-surface-track)'); // the toggle trough
    expect(reportRules).toContain('var(--fwm-surface-card)'); // POSITION card + dial disc
    expect(reportRules).toContain('var(--fwm-surface-control)'); // close, tiles, field, chips
  });

  it('never draws the 2px corner v1 used, and never draws a pill', () => {
    // v2's radius census: 8px x30, 999px x28, 6px x12 -- and 2px zero times.
    expect(reportRules).not.toContain('--fwm-radius-1');
    // --fwm-radius-full survives on exactly one thing: the round queue dot.
    // The mount chips were 999px pills in v1 and are 8px chips in v2.
    const chip = /\.fwm-report-chip\s*\{([^}]*)\}/.exec(reportRules);
    expect(chip?.[1]).toContain('var(--fwm-radius-3)');
    expect(chip?.[1]).not.toContain('var(--fwm-radius-full)');
  });

  it('keeps the two edges v2 kept, and only those two', () => {
    // The crimson rule under the header...
    const header = /\.fwm-report-header\s*\{([^}]*)\}/.exec(reportRules);
    expect(header?.[1]).toContain('border-bottom');
    expect(header?.[1]).toContain('var(--fwm-alert-in-range)');

    // ...and the tinted edge on the SELECTED mount chip, which is the one chip
    // state that has to read across a car. Unselected chips are edgeless: the
    // declared edge is transparent so selecting one cannot shift the layout.
    const pressed = /\.fwm-report-chip\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(reportRules);
    expect(pressed?.[1]).toContain('border-color: var(--fwm-tint-in-range-line)');
    expect(pressed?.[1]).toContain('background: var(--fwm-tint-in-range-weak)');
    expect(pressed?.[1]).toContain('color: var(--fwm-alert-in-range-text)');

    const chip = /\.fwm-report-chip\s*\{([^}]*)\}/.exec(reportRules);
    expect(chip?.[1]).toContain('solid transparent');
  });

  it('paints the facing arc from a token instead of fading the hue with opacity', () => {
    // v1 had no 35% crimson to name, so it drew the hue and dimmed it. The
    // tokens phase landed --fwm-tint-in-range-arc, v2's own mix, named for
    // this arc -- so the wedge is paint again and the sheet declares no opacity.
    const wedge = /\.fwm-report-dial-wedge\s*\{([^}]*)\}/.exec(reportRules);
    expect(wedge?.[1]).toContain('var(--fwm-tint-in-range-arc)');
    expect(wedge?.[1]).not.toContain('opacity');
  });

  it('fills the compass disc rather than stroking a ring around nothing', () => {
    const ring = /\.fwm-report-dial-ring\s*\{([^}]*)\}/.exec(reportRules);
    expect(ring?.[1]).toContain('fill: var(--fwm-surface-card)');
    expect(ring?.[1]).toContain('stroke: none');
    // Same element, different paint: the SVG did not change shape.
    const { container } = render(<ReportView model={model()} />);
    expect(container.querySelector('.fwm-report-dial-ring')).not.toBeNull();
  });

  it('extends the hit area of every control v2 drew under the 44px floor', () => {
    // v2 shrank the toggle halves to 40px and left the close key at 44x36.
    // House rule: keep the DRAWN size, grow the HIT AREA with a transparent
    // ::before -- the pattern `.fwm-sweep-key` established. A control that
    // silently grew to 44px would not match the design; one left at 40px would
    // not be pressable in a moving car.
    for (const selector of ['.fwm-report-mode::before', '.fwm-report-close::before']) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(reportRules);
      expect(rule, selector).not.toBeNull();
      expect(rule?.[1]).toContain('var(--fwm-touch-min)');
      expect(rule?.[1]).toContain('background: transparent');
    }
  });

  it('letters the pressed toggle half in v2 ink, not in the page ground', () => {
    // --fwm-text-on-alert (#0A0A0C) is v2's ink for a label on a saturated
    // fill. v1 used --fwm-bg. They are not the same colour and not the same
    // idea: --fwm-bg follows the mode's page, this follows the fill.
    const pressed = /\.fwm-report-mode\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(reportRules);
    expect(pressed?.[1]).toContain('background: var(--fwm-alert-in-range)');
    expect(pressed?.[1]).toContain('color: var(--fwm-text-on-alert)');
  });
});

describe('the stylesheet', () => {
  it('has no hover state anywhere: this is a touch-first product', () => {
    expect(reportRules).not.toContain(':hover');
  });

  it('carries no raw design value: every one is a token or a calc over one', () => {
    expect(reportRules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(reportRules).not.toMatch(/\brgba?\(/);
    // Colours are not the only way a literal gets in. A LENGTH, a DURATION or
    // an EASING would be missed by both greps above and by
    // `scripts/check-design-values.mjs` if it ever stopped scanning this file.
    expect(reportRules).not.toMatch(/(?<![\w-])-?\d*\.?\d+(px|rem|em|vh|vw|ms|deg)\b/);
    expect(reportRules).not.toMatch(/cubic-bezier\(/);
  });

  it('names its unitless ratios instead of hand-carrying them', () => {
    // `opacity` and `line-height` carry NO UNIT, which is exactly why the two
    // greps above and the enforcement script all miss them. They are the
    // stylesheet's last literals, so each is declared once as a
    // component-scoped local and referenced by name everywhere else.
    const ratios = reportRules.match(/(?:^|[;{])\s*(?:opacity|line-height)\s*:[^;]+/g) ?? [];
    expect(ratios.length).toBeGreaterThan(0);
    for (const declaration of ratios) {
      expect(declaration).toMatch(/var\(--fwm-/);
    }
  });

  it('renders no inline style, which is how a raw value would sneak in', () => {
    const { container } = render(<ReportView model={model()} onAdjustFacing={vi.fn()} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
