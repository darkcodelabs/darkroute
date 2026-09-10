import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gazetteer } from '../../services/cameras/gazetteer.ts';
import { atlasCounties } from '../../services/records/atlasCounties.ts';
import type { AtlasCounty } from '../../services/records/atlasCounties.ts';
import { camerasActions, positionActions, resetAllStores, useCamerasStore } from '../../stores';
import { NO_VALUE } from '../radar';
import { IntelScreen } from './IntelScreen.tsx';
import { IntelViewV1 } from './components/IntelViewV1.tsx';

// Map rendering has its own browser coverage; these tests exercise the selected
// camera, shared indexes and Details sheet without starting a WebGL renderer.
vi.mock('../map/LazyMiniMap.tsx', () => ({ LazyMiniMap: () => null }));

const NOW = 1_760_000_000_000;
const now = (): number => NOW;
const CAMERA = 'osm:atlas-one';
const OTHER_CAMERA = 'osm:atlas-two';
const COUNTY = '39061';
const OTHER_COUNTY = '29095';
const AGENCIES = [
  'Amberley Village Police Department',
  'Blue Ash Police Department',
  'Cincinnati Police Department',
  "Hamilton County Sheriff's Office",
  'Norwood Police Department',
  'Reading Police Department',
  'Springdale Police Department',
];
const FIRST: AtlasCounty = {
  fips: COUNTY, deployments: 9, agencies: AGENCIES,
  vendors: ['Flock Safety'], vendorKnown: 6,
};
const SECOND: AtlasCounty = {
  fips: OTHER_COUNTY, deployments: 3, agencies: ['Kansas City Police Department'],
  vendors: [], vendorKnown: 0,
};

let loaded: boolean;
let readable: boolean;
let geographyLoaded: boolean;
let countyRows: Map<string, AtlasCounty>;
let countyLabel: string;

beforeEach(() => {
  resetAllStores();
  vi.useFakeTimers();
  loaded = true;
  readable = true;
  geographyLoaded = true;
  countyRows = new Map([[COUNTY, FIRST], [OTHER_COUNTY, SECOND]]);
  countyLabel = 'HAMILTON CO, OH';
  vi.spyOn(atlasCounties, 'ready').mockImplementation(() => loaded);
  vi.spyOn(atlasCounties, 'refreshIfStale').mockResolvedValue(undefined);
  vi.spyOn(atlasCounties, 'coverageOf').mockImplementation((fips) => {
    if (!loaded || !readable || !fips) return 'unknown';
    return countyRows.has(fips) ? 'recorded' : 'none';
  });
  vi.spyOn(atlasCounties, 'forCounty').mockImplementation((fips) => (
    loaded && readable && fips ? countyRows.get(fips) ?? null : null
  ));
  vi.spyOn(atlasCounties, 'fetchedAt').mockReturnValue('2026-09-01T12:00:00Z');
  vi.spyOn(atlasCounties, 'source').mockReturnValue({
    name: 'Atlas of Surveillance', home: 'https://atlasofsurveillance.org/',
    attribution: 'EFF and the University of Nevada, Reno Reynolds School of Journalism',
    licenceObserved: 'CC BY', licenceConfirmed: false,
    licenceUrl: 'https://www.eff.org/copyright',
  });
  vi.spyOn(gazetteer, 'ready').mockImplementation(() => geographyLoaded);
  vi.spyOn(gazetteer, 'county').mockImplementation((fips) => {
    if (!geographyLoaded || !fips) return null;
    return {
      id: fips, name: fips === COUNTY ? 'Hamilton County' : 'Jackson County',
      label: fips === COUNTY ? countyLabel : 'JACKSON CO, MO', cameras: 42,
    };
  });
  vi.spyOn(gazetteer, 'place').mockReturnValue(null);
  camerasActions.putTile({
    ref: { z: 14, x: 4314, y: 6320 },
    cameras: [
      { id: CAMERA, lat: 39.1, lon: -84.58, directionDeg: null, countyFips: COUNTY },
      { id: OTHER_CAMERA, lat: 39.09, lon: -94.57, directionDeg: null, countyFips: OTHER_COUNTY },
      { id: 'osm:unplaced', lat: 39.1, lon: -84.58, directionDeg: null },
    ],
    fetchedAtMs: NOW, freshness: 'fresh', source: 'network',
  });
  // The phone is in the OTHER camera's county throughout these tests.
  positionActions.ingestFix({
    lat: 39.09, lon: -94.57, accuracyM: 4, altitudeM: null,
    altitudeAccuracyM: null, speedMps: 0, headingDeg: null, timestamp: NOW,
  });
  camerasActions.selectCamera(CAMERA);
});

afterEach(() => {
  cleanup();
  resetAllStores();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function openDetails(): HTMLElement {
  render(<IntelScreen now={now} queue={null} share={null} clipboard={null} view={IntelViewV1} />);
  fireEvent.click(screen.getByRole('button', { name: /Details/ }));
  return screen.getByRole('region', { name: 'camera details' });
}

function fact(details: HTMLElement, label: string): HTMLElement {
  const row = within(details).getByText(label, { exact: true }).closest('li');
  if (row === null) throw new Error(`Missing ${label} row`);
  return row;
}

function expandAtlas(details: HTMLElement): HTMLElement {
  const summary = within(details).getByText('County agencies and source');
  fireEvent.click(summary);
  const disclosure = summary.closest('details');
  if (disclosure === null) throw new Error('Missing Atlas disclosure');
  expect(disclosure).toHaveAttribute('open');
  return disclosure;
}

describe('Atlas in the selected camera Details', () => {
  it('updates an already open Details sheet when the shared Atlas snapshot changes', () => {
    let revision = 0;
    let changed: (() => void) | undefined;
    vi.spyOn(atlasCounties, 'getRevision').mockImplementation(() => revision);
    vi.spyOn(atlasCounties, 'subscribe').mockImplementation((listener) => {
      changed = listener;
      return () => { changed = undefined; };
    });
    const details = openDetails();
    const disclosure = expandAtlas(details);
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('7 agencies');
    act(() => {
      countyRows.set(COUNTY, { ...FIRST, agencies: ['Recently added agency'] });
      revision += 1;
      changed?.();
    });
    expect(screen.getByRole('region', { name: 'camera details' })).toBe(details);
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('1 agency in this county');
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveTextContent('Recently added agency');
    expect(disclosure).not.toHaveTextContent('Cincinnati Police Department');
  });

  it('refreshes delayed Atlas and county names while Details stays open', () => {
    loaded = false;
    geographyLoaded = false;
    const details = openDetails();
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('Loading county data');
    expect(atlasCounties.coverageOf).toHaveBeenCalledWith(undefined);

    act(() => { loaded = true; vi.advanceTimersByTime(400); });
    expect(screen.getByRole('region', { name: 'camera details' })).toBe(details);
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('7 agencies in this county');
    const disclosure = expandAtlas(details);
    expect(disclosure).toHaveTextContent('This camera’s county');

    act(() => { geographyLoaded = true; vi.advanceTimersByTime(400); });
    expect(disclosure).toHaveTextContent('HAMILTON CO, OH');
    expect(disclosure).toHaveAttribute('open');
  });

  it('uses the selected camera county and updates when selection changes', () => {
    const details = openDetails();
    const disclosure = expandAtlas(details);
    expect(disclosure).toHaveTextContent('HAMILTON CO, OH');
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('7 agencies');

    act(() => { camerasActions.selectCamera(OTHER_CAMERA); });
    expect(screen.getByRole('region', { name: 'camera details' })).toBe(details);
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('1 agency in this county');
    expect(disclosure).toHaveTextContent('JACKSON CO, MO');
    expect(disclosure).toHaveTextContent('Kansas City Police Department');
    expect(disclosure).not.toHaveTextContent('Cincinnati Police Department');
  });

  it('shows all seven agencies and partial vendor records without assigning camera ownership', () => {
    const details = openDetails();
    expect(fact(details, 'EFF ATLAS')).toHaveAttribute('data-fwm-tone', 'default');
    const disclosure = expandAtlas(details);
    const agencies = within(disclosure).getByRole('list', {
      name: 'agencies recorded using ALPR in this county',
    });
    expect(within(agencies).getAllByRole('listitem').map((item) => item.textContent)).toEqual(AGENCIES);
    expect(disclosure).toHaveTextContent('6 of 9 deployment records');
    expect(disclosure).toHaveTextContent('Flock Safety');
    expect(disclosure).toHaveTextContent('retrieved 1 Sept 2026');
    expect(disclosure).toHaveTextContent('University of Nevada, Reno');
    expect(within(disclosure).getByRole('link', { name: 'Open EFF Atlas of Surveillance' }))
      .toHaveAttribute('rel', 'noopener noreferrer');
    for (const label of ['OWNER', 'INTER-AGENCY SHARING']) {
      expect(fact(details, label)).toHaveTextContent(NO_VALUE);
      expect(fact(details, label)).toHaveAttribute('data-fwm-known', 'false');
    }
  });

  it('distinguishes a read Atlas with no county row from an unreadable Atlas', () => {
    countyRows.delete(COUNTY);
    const details = openDetails();
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('No agencies listed in this county');
    expect(expandAtlas(details)).toHaveTextContent('an unlisted agency may still use ALPR');

    cleanup();
    readable = false;
    const unavailable = openDetails();
    expect(fact(unavailable, 'EFF ATLAS')).toHaveTextContent('County data unavailable');
    expect(fact(unavailable, 'EFF ATLAS')).toHaveAttribute('data-fwm-known', 'false');
    expect(within(unavailable).queryByText('County agencies and source')).toBeNull();
  });

  it('states when the camera has no county instead of using the phone location', () => {
    camerasActions.selectCamera('osm:unplaced');
    const details = openDetails();
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('Camera county not recorded');
    expect(within(details).queryByText('County agencies and source')).toBeNull();
  });

  it('refreshes geography after the camera generation changes', () => {
    const details = openDetails();
    const disclosure = expandAtlas(details);
    expect(disclosure).toHaveTextContent('HAMILTON CO, OH');
    act(() => {
      geographyLoaded = false;
      useCamerasStore.setState({ generation: 'replacement-generation' });
    });
    expect(disclosure).toHaveTextContent('This camera’s county');
    expect(fact(details, 'EFF ATLAS')).toHaveTextContent('7 agencies');
    act(() => {
      geographyLoaded = true;
      countyLabel = 'HAMILTON COUNTY, OH';
      vi.advanceTimersByTime(400);
    });
    expect(disclosure).toHaveTextContent('HAMILTON COUNTY, OH');
  });
});
