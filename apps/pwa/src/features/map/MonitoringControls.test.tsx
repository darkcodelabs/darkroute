import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitoringControls } from './MonitoringControls.tsx';
import { useSettingsStore, mergePersistedSettings } from '../../stores/settings.ts';
import { monitoringCounts, MONITORING_OFF, selectedMonitoring } from '../../services/records/monitoringCatalog.ts';
import { monitoringSnapshotFixture } from '../../services/records/monitoringFixture.ts';
import { roadMonitoring } from '../../services/records/roadMonitoring.ts';

beforeEach(() => { useSettingsStore.getState().reset(); });
describe('optional road monitoring controls', () => {
  it('defaults every type off and enables only the chosen type', () => {
    render(<MonitoringControls />);
    expect(screen.getAllByRole('switch')).toHaveLength(7);
    for (const control of screen.getAllByRole('switch')) expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('switch', { name: 'Bluetooth sensors' }));
    expect(screen.getByRole('switch', { name: 'Bluetooth sensors' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Travel-time probes' })).toHaveAttribute('aria-checked', 'false');
    const selected = selectedMonitoring(monitoringSnapshotFixture.records, useSettingsStore.getState().monitoringTypes);
    expect(selected.map((record) => record.id)).toEqual(['sensor-one', 'retired-three']);
    expect(monitoringCounts(selected)).toEqual({ active: 1, inactive: 1, unknown: 0 });
  });
  it('hydrates a closed strict-boolean type set, leaving unknown and new kinds off', () => {
    expect(mergePersistedSettings({}).monitoringTypes).toEqual(MONITORING_OFF);
    expect(mergePersistedSettings({ monitoringTypes: { bluetooth_sensor: true, traffic_camera: 'true', other: true } }).monitoringTypes)
      .toEqual({ ...MONITORING_OFF, bluetooth_sensor: true });
  });
  it('explains absent viewport coverage and exposes dates and publisher coverage', () => {
    useSettingsStore.getState().setMonitoringType('probe_sensor', true);
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
