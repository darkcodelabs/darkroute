/**
 * The live zone card.
 *
 * Three things this asserts, and they are the three ways this card can lie:
 *
 *   1. It never invents a place name. The gazetteer misses for the 26,289
 *      cameras on unincorporated land, and the card must say so rather than
 *      reach for the nearest label.
 *   2. Its radius is labelled. The dial above prints the distance to the
 *      NEAREST camera; this prints the radius the counts were taken over. Two
 *      bare mile figures on one screen read as one number contradicting itself.
 *   3. Zero is drawn as an answer, not as an absence. "0 POLICE" is
 *      information.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ZoneLive } from '../zoneLive.ts';

import { ZONE_EMPTY, ZONE_EYEBROW, ZONE_UNINCORPORATED, ZoneCard } from './ZoneCard.tsx';

const { place, county } = vi.hoisted(() => ({ place: vi.fn(), county: vi.fn() }));

vi.mock('../../../services/cameras/gazetteer.ts', () => ({
  gazetteer: { place, county, ready: () => true },
}));

afterEach(() => {
  vi.resetAllMocks();
});

function zone(overrides: Partial<ZoneLive> = {}): ZoneLive {
  return {
    total: 15,
    police: 0,
    hoaPrivate: 0,
    unverified: 15,
    placeGeoid: '2053775',
    countyFips: '20091',
    radiusMi: 2,
    ...overrides,
  };
}

describe('ZoneCard', () => {
  it('leads with the place and puts the county underneath it', () => {
    place.mockReturnValue({ id: '2053775', name: 'Overland Park', label: 'OVERLAND PARK', cameras: 15 });
    county.mockReturnValue({ id: '20091', name: 'Johnson', label: 'JOHNSON CO, KS', cameras: 900 });

    render(<ZoneCard zone={zone()} state="clear" />);
    expect(screen.getByRole('heading').textContent).toBe('OVERLAND PARK');
    expect(screen.getByText('JOHNSON CO, KS')).toBeInTheDocument();
  });

  it('labels the radius so it cannot be read as the distance to a camera', () => {
    place.mockReturnValue({ id: '2053775', name: 'Overland Park', label: 'OVERLAND PARK', cameras: 15 });
    county.mockReturnValue(null);

    render(<ZoneCard zone={zone({ radiusMi: 2 })} state="clear" />);
    expect(screen.getByText('WITHIN 2 MI')).toBeInTheDocument();
  });

  it('falls back to the county, and says unincorporated rather than guessing a city', () => {
    place.mockReturnValue(null);
    county.mockReturnValue({ id: '20091', name: 'Johnson', label: 'JOHNSON CO, KS', cameras: 900 });

    render(<ZoneCard zone={zone({ placeGeoid: null })} state="clear" />);
    expect(screen.getByRole('heading').textContent).toBe('JOHNSON CO, KS');
    expect(screen.getByText(ZONE_UNINCORPORATED)).toBeInTheDocument();
  });

  it('falls back to the eyebrow, with no subline, when neither name resolves', () => {
    place.mockReturnValue(null);
    county.mockReturnValue(null);

    const { container } = render(<ZoneCard zone={zone({ placeGeoid: null, countyFips: null })} state="clear" />);
    expect(screen.getByRole('heading').textContent).toBe(ZONE_EYEBROW);
    expect(container.querySelector('.fwm-radar-zone-subline')).toBeNull();
  });

  it('says so in words when nothing is cached, instead of drawing four zeroes', () => {
    place.mockReturnValue(null);
    county.mockReturnValue(null);

    const { container } = render(
      <ZoneCard zone={zone({ total: 0, unverified: 0, placeGeoid: null, countyFips: null })} state="clear" />,
    );
    expect(screen.getByText(ZONE_EMPTY)).toBeInTheDocument();
    expect(container.querySelector('.fwm-radar-zone-tiles')).toBeNull();
  });

  it('draws all four counts, muting the zeroes without hiding them', () => {
    place.mockReturnValue({ id: '2053775', name: 'Overland Park', label: 'OVERLAND PARK', cameras: 15 });
    county.mockReturnValue(null);

    const { container } = render(
      <ZoneCard zone={zone({ total: 15, police: 3, hoaPrivate: 0, unverified: 12 })} state="clear" />,
    );
    const tiles = Array.from(container.querySelectorAll<HTMLElement>('.fwm-radar-zone-tile'));
    expect(tiles.map((tile) => tile.dataset['fwmRadarZoneTile'])).toEqual([
      'CAMERAS',
      'POLICE',
      'HOA / PRIVATE',
      'UNVERIFIED',
    ]);
    // "0 HOA / PRIVATE" is a fact about the zone, so it is drawn -- muted, not
    // dropped. A missing tile would read as a missing measurement.
    const hoa = tiles[2]!;
    expect(hoa.dataset['fwmRadarZoneZero']).toBe('true');
    expect(hoa.textContent).toContain('0');
    expect(tiles[1]!.dataset['fwmRadarZoneZero']).toBe('false');
  });

  it('carries the radar state so the rule is lit in the same hue the dial is', () => {
    place.mockReturnValue(null);
    county.mockReturnValue(null);

    for (const state of ['clear', 'approaching', 'in_range'] as const) {
      const { container, unmount } = render(<ZoneCard zone={zone()} state={state} />);
      expect(
        container.querySelector<HTMLElement>('.fwm-radar-zone')?.dataset['fwmRadarZoneState'],
      ).toBe(state);
      unmount();
    }
  });
});
