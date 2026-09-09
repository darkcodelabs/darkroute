/**
 * `B6 · ZONE AUDIT - SHAREABLE CARD + HEAT LAYER`, rendered from a view model,
 * against what the design draws.
 *
 * Reference: `Flockys Screens II.dc.html`, panel `B6` (lines 593-635).
 *
 * `zone-audit.css` is READ FROM DISK, not imported. vitest runs with
 * `css: false`, which stubs every CSS import -- `?raw` included -- to an empty
 * string, so an assertion against the import would pass on '' no matter what
 * the file says.
 */

// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  HEAT_CAPTION,
  HEAT_CAPTION_RECORDED,
  HEAT_GRID_COLS,
  HEAT_GRID_ROWS,
  SHARE_CARD_EYEBROW,
  camerasInZone,
  heatCells,
  zoneStats,
} from '../zone.ts';
import type { ZoneStats } from '../zone.ts';

import { ZONE_AUDIT_TITLE, ZONE_NOTICES, ZoneAuditView } from './ZoneAuditView.tsx';
import type { ZoneAuditViewModel } from './ZoneAuditView.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const zoneCss: string = readFileSync(`${HERE}/../zone-audit.css`, 'utf8');
/** Rules only. The file's prose explains why there is no pointer state, in words. */
const zoneRules: string = zoneCss.replace(/\/\*[\s\S]*?\*\//g, '');

const CENTRE = { lat: 39.1, lon: -84.58 };

const ZONE = camerasInZone(
  [
    {
      id: 'FWM-0442',
      lat: 39.11448,
      lon: -84.58,
      directionDeg: 180,
      ownerType: 'police',
      confirmations: 4,
    },
    { id: 'FWM-0118', lat: 39.1, lon: -84.56136, directionDeg: null, ownerType: 'inter_agency' },
    { id: 'FWM-0873', lat: 39.09276, lon: -84.58, directionDeg: null, ownerType: 'hoa' },
  ],
  CENTRE,
  2,
  new Map([['FWM-0442', 4]]),
  new Map([['FWM-0442', 4]]),
);

/** B6's own numbers, so the card can be read against the panel. */
const DRAWN_STATS: ZoneStats = {
  total: 47,
  police: 19,
  hoaPrivate: 28,
  sharedOutside: 31,
  facingInbound: 22,
  unclassified: 0,
};

const AT = new Date(2026, 7, 19, 9, 30).getTime();

function model(over: Partial<ZoneAuditViewModel> = {}): ZoneAuditViewModel {
  return {
    radiusMi: 2,
    cells: heatCells({ cameras: ZONE, radiusMi: 2, milesDriven: 4, tripCameraIds: ['FWM-0118'] }),
    heatCaption: HEAT_CAPTION,
    heatUnavailable: null,
    tripOverlay: true,
    stats: DRAWN_STATS,
    place: null,
    atMs: AT,
    origin: null,
    exportableRows: ZONE.length,
    notice: null,
    ...over,
  };
}

function cells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.fwm-zone-heat-cell')];
}

describe('the panel', () => {
  it('draws the header the panel draws', () => {
    render(<ZoneAuditView model={model()} />);
    expect(screen.getByRole('heading', { name: ZONE_AUDIT_TITLE })).toBeInTheDocument();
    expect(screen.getByText('2 MI RADIUS')).toBeInTheDocument();
  });

  it('draws the heat layer, its caption and its legend', () => {
    const { container } = render(<ZoneAuditView model={model()} />);
    expect(screen.getByText(HEAT_CAPTION)).toBeInTheDocument();
    expect(cells(container)).toHaveLength(HEAT_GRID_COLS * HEAT_GRID_ROWS);
    expect(screen.getByText('LOW')).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('HEAVY')).toBeInTheDocument();
    expect(screen.getByText('TRIP OVERLAY ON')).toBeInTheDocument();
  });

  it('draws the eyebrow and every line of the card', () => {
    render(<ZoneAuditView model={model()} />);
    expect(screen.getByText(SHARE_CARD_EYEBROW)).toBeInTheDocument();
    // The lockup's two halves, separately, because they are separately
    // coloured. `Dark` is the base and `Route` carries the in-range hue.
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Route')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('license plate readers within 2 miles.')).toBeInTheDocument();
    for (const [label, value] of [
      ['POLICE-OWNED', '19'],
      ['HOA / PRIVATE', '28'],
      ['SHARED TO OUTSIDE AGENCIES', '31'],
      ['FACING INBOUND TRAFFIC', '22'],
    ]) {
      const row = screen.getByText(label as string).closest('.fwm-zone-card-row');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(value as string)).toBeInTheDocument();
    }
    expect(screen.getByText(/COMMUNITY-REPORTED · AUG 19 2026/)).toBeInTheDocument();
  });

  it('draws both footer keys', () => {
    render(<ZoneAuditView model={model()} onShare={vi.fn()} onExportCsv={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'SHARE CARD' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'EXPORT CSV' })).toBeEnabled();
  });

  it('draws neither the dock nor the REPORT bar, which B6 does not draw', () => {
    render(<ZoneAuditView model={model()} />);
    expect(screen.queryByText('REPORT CAMERA')).not.toBeInTheDocument();
    expect(screen.queryByText('RADAR')).not.toBeInTheDocument();
    expect(screen.queryByText('SWEEP')).not.toBeInTheDocument();
  });
});

describe('the heat layer', () => {
  it('bands a cell by the rate its reads produced', () => {
    const { container } = render(<ZoneAuditView model={model()} />);
    const banded = cells(container).filter((cell) => cell.dataset['fwmZoneHeatRank'] !== 'none');
    expect(banded).toHaveLength(1);
    expect(banded[0]?.dataset['fwmZoneHeatRank']).toBe('heavy');
    expect(banded[0]?.dataset['fwmZoneHeatReads']).toBe('4');
  });

  it('outlines the cells the trip reached only while the overlay is on', () => {
    const { container, rerender } = render(<ZoneAuditView model={model()} />);
    expect(
      container.querySelector<HTMLElement>('.fwm-zone-heat')?.dataset['fwmZoneTripOverlay'],
    ).toBe('on');
    expect(
      cells(container).filter((cell) => cell.dataset['fwmZoneHeatTrip'] === 'true'),
    ).toHaveLength(1);
    rerender(<ZoneAuditView model={model({ tripOverlay: false })} />);
    expect(
      container.querySelector<HTMLElement>('.fwm-zone-heat')?.dataset['fwmZoneTripOverlay'],
    ).toBe('off');
    expect(screen.getByText('TRIP OVERLAY OFF')).toBeInTheDocument();
  });

  it('says why it is empty instead of drawing a blob that is not there', () => {
    const { container } = render(
      <ZoneAuditView model={model({ heatUnavailable: 'NO READS RECORDED IN THIS ZONE YET' })} />,
    );
    expect(screen.getByText('NO READS RECORDED IN THIS ZONE YET')).toBeInTheDocument();
    expect(cells(container)).toHaveLength(0);
    /* The caption and the legend stay, so it is recognisably the same surface. */
    expect(screen.getByText(HEAT_CAPTION)).toBeInTheDocument();
    expect(screen.getByText('HEAVY')).toBeInTheDocument();
  });

  it('lays the grid out at the resolution the model counts at', () => {
    expect(zoneRules).toContain(`repeat(${String(HEAT_GRID_COLS)}, 1fr)`);
    expect(zoneRules).toContain(`repeat(${String(HEAT_GRID_ROWS)}, 1fr)`);
  });

  /* A count carried under a rate's caption is a claim nobody measured. The
   * caption is a model value, not a constant the layer assumes. */
  it('prints the caption the model gives it, and never the drawn one by default', () => {
    render(<ZoneAuditView model={model({ heatCaption: HEAT_CAPTION_RECORDED })} />);
    expect(screen.getByText(HEAT_CAPTION_RECORDED)).toBeInTheDocument();
    expect(screen.queryByText(HEAT_CAPTION)).not.toBeInTheDocument();
  });

  it('labels the grid for a screen reader with the same caption it prints', () => {
    render(<ZoneAuditView model={model({ heatCaption: HEAT_CAPTION_RECORDED })} />);
    expect(screen.getByRole('img', { name: HEAT_CAPTION_RECORDED })).toBeInTheDocument();
  });
});

describe('a zone that cannot be stated', () => {
  it('prints an em dash for every numeral rather than a plausible zero', () => {
    const { container } = render(
      <ZoneAuditView
        model={model({
          stats: null,
          exportableRows: 0,
          heatUnavailable: 'NO FIX · ZONE NOT LOCATED',
        })}
      />,
    );
    expect(container.querySelector('[data-fwm-zone-card-hero="true"]')?.textContent).toBe('—');
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('disables both keys, because there is nothing to share and nothing to export', () => {
    render(
      <ZoneAuditView
        model={model({ stats: null, exportableRows: 0 })}
        onShare={vi.fn()}
        onExportCsv={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'SHARE CARD' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EXPORT CSV' })).toBeDisabled();
  });
});

describe('controls with nothing wired to them', () => {
  it('renders disabled rather than live-looking and inert', () => {
    render(<ZoneAuditView model={model()} />);
    expect(screen.getByRole('button', { name: /2 MI RADIUS/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'TRIP OVERLAY ON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SHARE CARD' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EXPORT CSV' })).toBeDisabled();
  });

  it('calls each handler exactly once when it is wired', () => {
    const onRadius = vi.fn();
    const onTripOverlay = vi.fn();
    const onShare = vi.fn();
    const onExportCsv = vi.fn();
    render(
      <ZoneAuditView
        model={model()}
        onRadius={onRadius}
        onTripOverlay={onTripOverlay}
        onShare={onShare}
        onExportCsv={onExportCsv}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /2 MI RADIUS/ }));
    fireEvent.click(screen.getByRole('button', { name: 'TRIP OVERLAY ON' }));
    fireEvent.click(screen.getByRole('button', { name: 'SHARE CARD' }));
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT CSV' }));
    expect(onRadius).toHaveBeenCalledTimes(1);
    expect(onTripOverlay).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });
});

describe('the card carries no domain it was not configured with', () => {
  it('draws no origin line when nothing configured one', () => {
    const { container } = render(<ZoneAuditView model={model()} />);
    expect(container.querySelector('.fwm-zone-card-origin')).toBeNull();
    expect(container.textContent).not.toContain('darkroute.app');
  });

  it('draws the line a build configured, verbatim', () => {
    render(<ZoneAuditView model={model({ origin: 'example.test' })} />);
    expect(screen.getByText('example.test')).toBeInTheDocument();
  });
});

describe('what the last press did', () => {
  it('says nothing at all until something has been pressed', () => {
    const { container } = render(<ZoneAuditView model={model()} />);
    const notice = container.querySelector<HTMLElement>('.fwm-zone-notice');
    expect(notice?.textContent).toBe('');
    expect(notice?.dataset['fwmZoneNotice']).toBe('none');
  });

  it('names the outcome rather than implying a success the platform did not give', () => {
    render(<ZoneAuditView model={model({ notice: 'share-unavailable' })} />);
    expect(screen.getByText(ZONE_NOTICES['share-unavailable'])).toBeInTheDocument();
  });

  /* B6 draws no notice at all, so the row is an addition. An addition that
   * APPEARS on the first press shoves the two footer keys down the moment the
   * driver touches one, which changes the panel's drawn vertical rhythm. It
   * holds its line while it is empty. */
  it('shifts nothing below it when it fills, because it was always there', () => {
    const { container, rerender } = render(<ZoneAuditView model={model()} />);
    const body = container.querySelector('.fwm-zone-body');
    const before = [...(body?.children ?? [])].map((child) => child.className);
    rerender(<ZoneAuditView model={model({ notice: 'csv-exported' })} />);
    const after = [...(body?.children ?? [])].map((child) => child.className);
    expect(after).toEqual(before);
    expect(screen.getByText(ZONE_NOTICES['csv-exported'])).toBeInTheDocument();
  });

  it('reserves the line in the stylesheet as well as in the tree', () => {
    expect(zoneRules).toMatch(/\.fwm-zone-notice \{[^}]*min-height:/);
  });

  /* It is announced, not only drawn: the outcome of a press the driver cannot
   * see is the one they most need told. */
  it('announces the outcome through a live region', () => {
    render(<ZoneAuditView model={model({ notice: 'shared' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(ZONE_NOTICES.shared);
  });
});

describe('no pointer affordance', () => {
  it('declares no pointer-state rule anywhere in zone-audit.css', () => {
    expect(zoneRules).not.toContain(':hover');
  });

  it('carries no pointer variant on any attribute in the rendered tree', () => {
    const { container } = render(<ZoneAuditView model={model()} />);
    for (const el of container.querySelectorAll('*')) {
      for (const attribute of el.attributes) {
        expect(attribute.value.toLowerCase()).not.toContain('hover');
      }
    }
  });
});

describe('a disabled key is still a key', () => {
  /* B6 draws the primary key FILLED. `background: transparent` on the disabled
   * state erased that fill, so a zone that could not be stated drew no SHARE
   * CARD key at all -- two words on the page ground where the panel draws a
   * block. */
  it('does not blank the primary key fill when it is disabled', () => {
    const disabled = /\.fwm-zone-action:disabled \{([^}]*)\}/.exec(zoneRules)?.[1] ?? '';
    expect(disabled).not.toBe('');
    expect(disabled).not.toMatch(/background:\s*transparent/);
    expect(disabled).toMatch(/background:\s*var\(--fwm-[a-z0-9-]+\)/);
  });

  it('keeps drawing both keys, in their drawn tones, with nothing to act on', () => {
    const { container } = render(
      <ZoneAuditView model={model({ stats: null, exportableRows: 0 })} />,
    );
    const tones = [...container.querySelectorAll<HTMLElement>('.fwm-zone-action')].map(
      (key) => key.dataset['fwmZoneActionTone'],
    );
    expect(tones).toEqual(['primary', 'secondary']);
  });
});

describe('no raw design value reaches the DOM', () => {
  it('renders not one inline style', () => {
    const { container } = render(<ZoneAuditView model={model()} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('draws every band with a token, never a literal colour', () => {
    expect(zoneRules).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(zoneRules).not.toMatch(/\brgba?\s*\(/);
  });
});

describe('the zone stats the card prints are the zone stats the model measured', () => {
  it('prints what zoneStats counted, not a recount of its own', () => {
    const measured = zoneStats(ZONE);
    render(<ZoneAuditView model={model({ stats: measured })} />);
    const hero = screen.getByText(String(measured.total));
    expect(hero).toBeInTheDocument();
    expect(measured.total).toBe(3);
  });
});
