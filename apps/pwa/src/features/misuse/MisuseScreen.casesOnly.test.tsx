import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { positionActions } from '../../stores/position.ts';
import { atlasCounties } from '../../services/records/atlasCounties.ts';
import { countyRecords } from '../../services/records/countyRecords.ts';
import { MisuseScreen } from './MisuseScreen.tsx';
import { setMisuseCasesOnly } from './misuseView.ts';

vi.mock('../../services/records/countyRecords.ts', () => ({ countyRecords: {
  all: () => [
    { fips: '39061', agency: 'First fixture agency', summary: 'First documented case', incidents: 2,
      year: 2026, sourceName: 'Fixture source', sourceUrl: 'https://source.test/first' },
    { fips: '39061', agency: 'Second fixture agency', summary: 'Second documented case', incidents: 1,
      year: 2025, sourceName: 'Fixture source', sourceUrl: 'https://source.test/second' },
    { fips: '39049', agency: 'Elsewhere fixture agency', summary: 'Case in another county', incidents: 1,
      year: 2026, sourceName: 'Fixture source', sourceUrl: 'https://source.test/third' },
  ], ready: () => true, generatedAt: () => '2026-09-10T00:00:00Z',
} }));
vi.mock('../../services/records/atlasCounties.ts', () => ({ ATLAS_REFRESH_INTERVAL_MS: 300_000, atlasCounties: {
  ready: () => true, fetchedAt: () => null, checkedAt: () => null,
  coverageOf: () => 'unknown', forCounty: () => null, source: () => null,
  getRevision: () => 0, subscribe: () => () => undefined, refreshIfStale: async () => undefined,
} }));
vi.mock('../../services/records/countyLocate.ts', () => ({ countyLocator: {
  locate: async () => ({ fips: '39061' }),
} }));
vi.mock('../news/LatestAbuseNews.tsx', () => ({ LatestAbuseNews: () =>
  <section aria-label="Latest abuse reporting">Automatically collected reporting</section>,
}));

const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Documented cases only' });
const cards = (): HTMLElement[] => within(screen.getByRole('list', { name: 'records' })).queryAllByRole('link');

beforeEach(() => { setMisuseCasesOnly(false); positionActions.reset(); });
afterEach(() => { setMisuseCasesOnly(false); positionActions.reset(); vi.useRealTimers(); });

describe('documented cases view', () => {
  it.each([false, true])('shows loaded cases while Atlas is still pending (cases only: %s)', async (casesOnly) => {
    vi.useFakeTimers();
    const loaded = countyRecords.all();
    let recordsReady = false;
    vi.spyOn(countyRecords, 'all').mockImplementation(() => recordsReady ? loaded : []);
    vi.spyOn(countyRecords, 'ready').mockImplementation(() => recordsReady);
    vi.spyOn(atlasCounties, 'ready').mockReturnValue(false);
    setMisuseCasesOnly(casesOnly);
    render(<MisuseScreen />);
    expect(cards()).toHaveLength(0);
    recordsReady = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(cards()).toHaveLength(3);
    expect(screen.getByText(/3 cases · 4 incidents/)).toBeInTheDocument();
    expect(atlasCounties.ready()).toBe(false);
  });

  it('includes news and Atlas by default, then hides both while keeping the documented cases and counts', () => {
    render(<MisuseScreen />);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: 'Latest abuse reporting' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'atlas of surveillance' })).toBeInTheDocument();
    const originalLinks = cards().map((card) => card.getAttribute('href'));
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('data-fwm-selected', 'false');
    expect(screen.queryByRole('region', { name: 'Latest abuse reporting' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'atlas of surveillance' })).toBeNull();
    expect(cards().map((card) => card.getAttribute('href'))).toEqual(originalLinks);
    expect(screen.getByText(/3 cases · 4 incidents/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Near me' })).toBeDisabled();
  });

  it('accepts map context before mounting, retains it across screen visits, and can restore all context', () => {
    setMisuseCasesOnly(true);
    const first = render(<MisuseScreen />);
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Latest abuse reporting' })).toBeNull();
    first.unmount();
    render(<MisuseScreen />);
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: 'Latest abuse reporting' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'atlas of surveillance' })).toBeInTheDocument();
    act(() => { setMisuseCasesOnly(true); });
    expect(screen.queryByRole('region', { name: 'atlas of surveillance' })).toBeNull();
    act(() => { setMisuseCasesOnly(false); });
    expect(screen.getByRole('region', { name: 'atlas of surveillance' })).toBeInTheDocument();
  });

  it('preserves active year and Near me filters while switching context in either direction', async () => {
    render(<MisuseScreen />);
    act(() => { positionActions.ingestFix({ lat: 39.1031, lon: -84.512, accuracyM: 5,
      altitudeM: null, altitudeAccuracyM: null, speedMps: 0, headingDeg: null, timestamp: 1_000_000 }); });
    const near = screen.getByRole('button', { name: 'Near me' });
    await waitFor(() => { expect(near).not.toBeDisabled(); });
    fireEvent.click(near);
    fireEvent.click(screen.getByRole('button', { name: '2026' }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveAttribute('href', 'https://source.test/first');
    for (let index = 0; index < 2; index++) {
      fireEvent.click(toggle());
      expect(near).toHaveAttribute('data-fwm-selected', 'true');
      expect(screen.getByRole('button', { name: '2026' })).toHaveAttribute('data-fwm-selected', 'true');
      expect(cards()).toHaveLength(1);
      expect(cards()[0]).toHaveAttribute('href', 'https://source.test/first');
      expect(screen.getByText(/3 cases · 4 incidents/)).toBeInTheDocument();
    }
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(cards()).toHaveLength(3);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(near).toHaveAttribute('data-fwm-selected', 'false');
    expect(screen.getByRole('button', { name: '2026' })).toHaveAttribute('data-fwm-selected', 'false');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('data-fwm-selected', 'true');
    expect(screen.getByRole('region', { name: 'Latest abuse reporting' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'atlas of surveillance' })).toBeInTheDocument();
  });
});
