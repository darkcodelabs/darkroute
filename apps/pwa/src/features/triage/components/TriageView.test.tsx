/**
 * `B4 · ALERT TRIAGE - BY OWNER TYPE`, rendered from a view model, against what
 * the design draws.
 *
 * Reference: `Flockys Screens II.dc.html`, panel `B4 · ALERT TRIAGE - BY OWNER
 * TYPE` (lines 497-546).
 *
 * `triage.css` is READ FROM DISK, not imported. vitest runs with `css: false`,
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

import type { CameraOwnerType } from '../../../stores';
import { OWNER_LABELS, TRIAGE_OWNER_TYPES, projectAlerts } from '../triage.ts';
import type { AlertProjection } from '../triage.ts';

import { MUTE_NOTICE_BODY, MUTE_NOTICE_TITLE } from './MuteNotice.tsx';
import type { OwnerRow } from './OwnerFilterList.tsx';
import { RE_ALERT_LABEL } from './ReAlertRow.tsx';
import { TriageView } from './TriageView.tsx';
import type { TriageViewModel } from './TriageView.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const triageCss: string = readFileSync(`${HERE}/../triage.css`, 'utf8');
/** Rules only. The file's prose explains why there is no pointer state, in words. */
const triageRules: string = triageCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The five rows exactly as B4 draws them: two on, three off. */
const DRAWN_ROWS: readonly OwnerRow[] = [
  {
    ownerType: 'police',
    label: 'POLICE / AGENCY',
    caption: 'shared to — agencies',
    enabled: true,
  },
  {
    ownerType: 'inter_agency',
    label: 'INTER-AGENCY SHARED',
    caption: 'any owner, shared feed',
    enabled: true,
  },
  {
    ownerType: 'hoa',
    label: 'HOA / NEIGHBORHOOD',
    caption: '11 on your usual routes',
    enabled: false,
  },
  {
    ownerType: 'private',
    label: 'PRIVATE / BUSINESS',
    caption: 'retail lots, storage',
    enabled: false,
  },
  {
    ownerType: 'unverified',
    label: 'UNVERIFIED REPORTS',
    caption: '1 confirmation only',
    enabled: false,
  },
];

/** `4`, down from `19`, over one drive -- the figures the panel prints. */
function drawnProjection(): AlertProjection {
  return {
    drives: 1,
    // The drive B4 draws is a drive that is over: the panel's qualifier reads
    // `with current filters`, not a running count of a drive still happening.
    driveInProgress: false,
    projected: 4,
    baseline: 19,
    filteredPasses: 4,
    totalPasses: 19,
    attributedPasses: 19,
    unattributedPasses: 0,
  };
}

function model(over: Partial<TriageViewModel> = {}): TriageViewModel {
  return {
    projection: drawnProjection(),
    rows: DRAWN_ROWS,
    reAlertFt: 150,
    ...over,
  };
}

function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.[\]"=]/g, (c) => `\\${c}`);
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(triageCss);
  return match?.[1] ?? null;
}

function row(container: HTMLElement, ownerType: CameraOwnerType): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-fwm-triage-owner="${ownerType}"]`);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

describe('header', () => {
  it('titles the screen TRIAGE and states what it is for', () => {
    render(<TriageView model={model()} />);

    expect(screen.getByRole('heading', { name: 'TRIAGE' })).toBeInTheDocument();
    expect(screen.getByText('ALERT FATIGUE CONTROL')).toBeInTheDocument();
  });
});

describe('ALERTS PER DRIVE - PROJECTED', () => {
  it('draws the figure, the number it is down from, and the qualifier', () => {
    const { container } = render(<TriageView model={model()} />);

    expect(screen.getByText('ALERTS PER DRIVE - PROJECTED')).toBeInTheDocument();
    const value = container.querySelector<HTMLElement>('.fwm-triage-projection-value');
    expect(value?.textContent).toBe('4');
    expect(screen.getByText('down from 19')).toBeInTheDocument();
    expect(screen.getByText('with current filters')).toBeInTheDocument();
  });

  it('draws the figure in the clear hue, and never animates the digits', () => {
    const body = ruleBody('.fwm-triage-projection-value');
    expect(body).toContain('color: var(--fwm-alert-clear);');
    expect(body).not.toContain('transition');
    expect(body).not.toContain('animation');
  });

  it('carries the numeral on a type token and names the size it does not render', () => {
    const body = ruleBody('.fwm-triage-projection-value');

    expect(body).toContain('font-size: var(--fwm-text-readout);');
    // B4 draws 56px. There is no 56px step, the readout step is the nearer of
    // the two that exist, and the shortfall is named in the file rather than
    // papered over with a calc that manufactures a size the system never
    // declared. If this ever changes it changes in tokens.css, not here.
    expect(triageCss).toContain('docs/gaps-inbox/triage.md#projection-numeral-is-56px');
    expect(body).not.toContain('calc(');
  });

  it('prints an em dash in the muted grey rather than a zero it has not earned', () => {
    const nothing = projectAlerts({
      passes: [],
      ownerOf: () => null,
      enabled: {
        police: true,
        inter_agency: true,
        hoa: true,
        private: true,
        unverified: true,
      },
      drives: 0,
      driveInProgress: false,
    });
    const { container } = render(<TriageView model={model({ projection: nothing })} />);

    const value = container.querySelector<HTMLElement>('.fwm-triage-projection-value');
    expect(value?.textContent).toBe('—');
    expect(value?.getAttribute('data-fwm-triage-projected')).toBe('unknown');
    expect(screen.getByText('no drives on record')).toBeInTheDocument();
    expect(
      ruleBody('.fwm-triage-projection-value[data-fwm-triage-projected="unknown"]'),
    ).toContain('color: var(--fwm-text-muted);');
  });
});

describe('the five owner rows', () => {
  it('draws all five, in the order and with the copy B4 prints', () => {
    const { container } = render(<TriageView model={model()} />);

    const rows = container.querySelectorAll('.fwm-triage-owner');
    expect(rows).toHaveLength(5);
    expect([...rows].map((el) => el.getAttribute('data-fwm-triage-owner'))).toEqual([
      ...TRIAGE_OWNER_TYPES,
    ]);

    for (const drawn of DRAWN_ROWS) {
      const el = row(container, drawn.ownerType);
      expect(within(el).getByText(drawn.label)).toBeInTheDocument();
      expect(within(el).getByText(drawn.caption)).toBeInTheDocument();
    }
  });

  it('reports each switch position to assistive technology, not only in colour', () => {
    render(<TriageView model={model()} onOwnerType={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'POLICE / AGENCY' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'HOA / NEIGHBORHOOD' })).not.toBeChecked();
  });

  it('fills the ON track in the in-range hue the design draws it in', () => {
    expect(ruleBody('.fwm-triage-switch[aria-checked="true"] .fwm-triage-switch-track')).toContain(
      'background: var(--fwm-alert-in-range);',
    );
  });

  it('hands the class and the new position to the caller on a press', () => {
    const onOwnerType = vi.fn();
    render(<TriageView model={model()} onOwnerType={onOwnerType} />);

    screen.getByRole('switch', { name: 'HOA / NEIGHBORHOOD' }).click();
    expect(onOwnerType).toHaveBeenCalledWith('hoa', true);

    screen.getByRole('switch', { name: 'POLICE / AGENCY' }).click();
    expect(onOwnerType).toHaveBeenCalledWith('police', false);
  });

  it('renders a switch with no handler disabled rather than inert and live-looking', () => {
    render(<TriageView model={model()} />);

    for (const owner of TRIAGE_OWNER_TYPES) {
      expect(screen.getByRole('switch', { name: OWNER_LABELS[owner] })).toBeDisabled();
    }
  });
});

describe('a switched-off class does not disappear', () => {
  it('keeps every row on the screen with its count intact when all five are off', () => {
    const allOff = DRAWN_ROWS.map((drawn) => ({ ...drawn, enabled: false }));
    const { container } = render(<TriageView model={model({ rows: allOff })} />);

    expect(container.querySelectorAll('.fwm-triage-owner')).toHaveLength(5);
    expect(
      within(row(container, 'hoa')).getByText('11 on your usual routes'),
    ).toBeInTheDocument();
  });

  it('dims the headline and does nothing else', () => {
    expect(
      ruleBody('.fwm-triage-owner[data-fwm-triage-owner-enabled="false"] .fwm-triage-owner-label'),
    ).toContain('color: var(--fwm-text-muted);');
    // No rule anywhere hides a row, collapses it, or drops it out of the flow.
    expect(triageRules).not.toContain('display: none');
    expect(triageRules).not.toContain('visibility: hidden');
  });

  it('prints the invariant out loud, verbatim', () => {
    render(<TriageView model={model()} />);

    expect(screen.getByText(MUTE_NOTICE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(MUTE_NOTICE_BODY)).toBeInTheDocument();
    expect(MUTE_NOTICE_TITLE).toBe("MUTED CAMERAS DON'T DISAPPEAR");
    expect(MUTE_NOTICE_BODY).toBe(
      'They still draw on SWEEP in grey, still count in EXPOSURE, still log to LOOKUP. ' +
        'Muting only removes the alert - never the record.',
    );
  });
});

describe('RE-ALERT ON MUTED IF', () => {
  it('draws the row, the stated distance, and the amber switch', () => {
    const { container } = render(<TriageView model={model()} onReAlert={vi.fn()} />);

    expect(screen.getByText(RE_ALERT_LABEL)).toBeInTheDocument();
    expect(screen.getByText('closer than 150 ft')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: RE_ALERT_LABEL })).toBeChecked();
    expect(
      container.querySelector('[data-fwm-triage-realert]')?.getAttribute('data-fwm-triage-realert'),
    ).toBe('on');
    expect(
      ruleBody(
        '.fwm-triage-switch[data-fwm-triage-switch-tone="pierce"][aria-checked="true"]\n  .fwm-triage-switch-track',
      ),
    ).toContain('background: var(--fwm-alert-approaching);');
  });

  it('says what off means instead of printing a distance that no longer applies', () => {
    render(<TriageView model={model({ reAlertFt: 0 })} onReAlert={vi.fn()} />);

    expect(screen.getByRole('switch', { name: RE_ALERT_LABEL })).not.toBeChecked();
    expect(screen.getByText('muted stays muted')).toBeInTheDocument();
  });

  it('hands the new position to the caller on a press', () => {
    const onReAlert = vi.fn();
    render(<TriageView model={model()} onReAlert={onReAlert} />);

    screen.getByRole('switch', { name: RE_ALERT_LABEL }).click();
    expect(onReAlert).toHaveBeenCalledWith(false);
  });
});

describe('chrome that belongs to the shell', () => {
  it('draws no second REPORT bar and no second dock', () => {
    render(<TriageView model={model()} />);

    expect(screen.queryByText('REPORT CAMERA')).not.toBeInTheDocument();
    expect(screen.queryByText('RADAR')).not.toBeInTheDocument();
    expect(screen.queryByText('SWEEP')).not.toBeInTheDocument();
  });
});

describe('no pointer affordance', () => {
  it('declares no pointer-state rule anywhere in triage.css', () => {
    expect(triageRules).not.toContain(':hover');
  });

  it('carries no pointer variant on any attribute in the rendered tree', () => {
    const { container } = render(<TriageView model={model()} />);
    for (const el of container.querySelectorAll('*')) {
      for (const attribute of el.attributes) {
        expect(attribute.value.toLowerCase()).not.toContain('hover');
      }
    }
  });
});

/**
 * The knob's side is `justify-content` keyed off `aria-checked` -- the same
 * attribute assistive technology reads -- and nothing else. Drop the ON
 * declaration and the knob stays parked on the left while the announcement
 * keeps flipping, which is the picture/announcement drift the decision exists
 * to prevent, and which no colour assertion would catch.
 * DECISION: docs/gaps-inbox/triage.md#knob-position-is-an-aria-attribute
 */
describe('the knob moves because aria-checked moved', () => {
  it('parks the knob at the OFF end of the track by default', () => {
    expect(ruleBody('.fwm-triage-switch-track')).toContain('justify-content: flex-start;');
  });

  it('drives it to the ON end off the attribute, not off a class or an offset', () => {
    expect(ruleBody('.fwm-triage-switch[aria-checked="true"] .fwm-triage-switch-track')).toContain(
      'justify-content: flex-end;',
    );
  });

  it('has no second mechanism that would hide the loss of that declaration', () => {
    const { container } = render(<TriageView model={model()} onOwnerType={vi.fn()} />);
    const on = screen.getByRole('switch', { name: 'POLICE / AGENCY' });
    const off = screen.getByRole('switch', { name: 'HOA / NEIGHBORHOOD' });

    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(off.getAttribute('aria-checked')).toBe('false');
    // Identical markup either side of the attribute: no ON class, no modifier,
    // no inline offset. The attribute IS the state, in the picture too.
    expect(on.innerHTML).toBe(off.innerHTML);
    expect(on.querySelector('.fwm-triage-switch-knob')).not.toBeNull();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    expect(triageRules).not.toContain('transform');
    expect(triageRules).not.toContain('margin-left: auto');
    expect(triageRules).not.toContain('position: absolute');
  });
});

describe('no raw design value reaches the DOM', () => {
  it('renders not one inline style', () => {
    const { container } = render(<TriageView model={model()} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
