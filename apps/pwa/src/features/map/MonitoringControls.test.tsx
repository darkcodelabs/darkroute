import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitoringControls } from './MonitoringControls.tsx';
import { useSettingsStore, mergePersistedSettings } from '../../stores/settings.ts';
import { monitoringCounts, MONITORING_ON, MONITORING_KINDS, selectedMonitoring } from '../../services/records/monitoringCatalog.ts';
import { monitoringSnapshotFixture } from '../../services/records/monitoringFixture.ts';
import { roadMonitoring } from '../../services/records/roadMonitoring.ts';

beforeEach(() => { useSettingsStore.getState().reset(); });
describe('road monitoring controls', () => {
  it('defaults every type on and disables only the chosen type', () => {
    render(<MonitoringControls />);
    expect(screen.getAllByRole('switch')).toHaveLength(7);
    for (const control of screen.getAllByRole('switch')) expect(control).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'Bluetooth sensors' }));
    expect(screen.getByRole('switch', { name: 'Bluetooth sensors' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Travel-time probes' })).toHaveAttribute('aria-checked', 'true');
    const selected = selectedMonitoring(monitoringSnapshotFixture.records, useSettingsStore.getState().monitoringTypes);
    expect(selected.map((record) => record.id)).toEqual(['probe-two']);
    expect(monitoringCounts(selected)).toEqual({ active: 0, inactive: 0, unknown: 1 });
  });
  it('preserves explicit off selections and defaults missing or malformed kinds on', () => {
    expect(mergePersistedSettings({}).monitoringTypes).toEqual(MONITORING_ON);
    expect(mergePersistedSettings({ monitoringTypes: { bluetooth_sensor: false, traffic_camera: 'false', other: true } }).monitoringTypes)
      .toEqual({ ...MONITORING_ON, bluetooth_sensor: false });
  });
  it('explains absent viewport coverage and exposes dates and publisher coverage', () => {
    for (const kind of MONITORING_KINDS) useSettingsStore.getState().setMonitoringType(kind, kind === 'probe_sensor');
    const state = { data: monitoringSnapshotFixture, loading: false, error: null };
    vi.spyOn(roadMonitoring, 'getSnapshot').mockReturnValue(state);
    render(<MonitoringControls visibleCount={0} />);
    expect(screen.getByText(/No selected inventory points in this view/)).toBeInTheDocument();
    expect(screen.getByText(/0 listed active · 1 status not reported · 0 inactive/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Coverage and sources (1)'));
    expect(screen.getByRole('link', { name: 'Public road inventory' })).toHaveAttribute('href', 'https://publisher.test/inventory');
    expect(screen.getByRole('button', { name: 'View Example County' })).toBeInTheDocument();
  });
});
