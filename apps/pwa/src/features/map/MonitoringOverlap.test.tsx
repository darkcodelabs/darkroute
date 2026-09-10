import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as core from '../../stores/fwmCore.ts';
import { MonitoringOverlap, summarizeMonitoringOverlap } from './MonitoringOverlap.tsx';

const record = Object.freeze({ lat: 41.8, lon: -87.6 });
function cameraAt(id: string, metres: number) {
  return Object.freeze({ id, ...core.destinationPoint(record.lat, record.lon, 0, metres) });
}

describe('road monitoring overlap with loaded ALPR points', () => {
  it('distinguishes an empty loaded set from a checked set with no nearby points', () => {
    const view = render(<MonitoringOverlap record={record} cameras={[]} onOpenCamera={vi.fn()} />);
    expect(screen.getByText('0 loaded ALPR points')).toBeInTheDocument();
    expect(screen.getByText('Within 100 m').nextElementSibling).toHaveTextContent('Not available');
    expect(screen.getByText(/Proximity cannot be checked/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    view.rerender(<MonitoringOverlap record={record} cameras={[cameraAt('far', 500)]} onOpenCamera={vi.fn()} />);
    expect(screen.getByText('1 loaded ALPR points')).toBeInTheDocument();
    expect(screen.getByText('Within 100 m').nextElementSibling).toHaveTextContent('0');
    expect(screen.queryByText(/Proximity cannot be checked/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open nearest ALPR details' })).toBeInTheDocument();
  });

  it('counts nearby points, finds the nearest independently of input order, and opens only on request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const getCurrentPosition = vi.fn(); const watchPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition, watchPosition } });
    const open = vi.fn();
    const cameras = Object.freeze([cameraAt('far', 500), cameraAt('near', 80), cameraAt('nearest', 25)]);
    render(<MonitoringOverlap record={record} cameras={cameras} onOpenCamera={open} />);
    expect(screen.getByText('3 loaded ALPR points')).toBeInTheDocument();
    expect(screen.getByText('Within 100 m').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Nearest loaded ALPR point').nextElementSibling).toHaveTextContent('25 m');
    expect(screen.getByText(/does not prove shared equipment, data sharing, or ALPR capability/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open nearest ALPR details' }));
    expect(open).toHaveBeenCalledExactlyOnceWith('nearest');
    expect(fetch).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(cameras.map(({ id }) => id)).toEqual(['far', 'near', 'nearest']);
  });

  it('includes the exact 100 m boundary using the core distance result', () => {
    // Core owns geodesic accuracy; this checks the inclusive product threshold.
    vi.spyOn(core, 'distanceM').mockReturnValueOnce(100).mockReturnValueOnce(100.001);
    const overlap = summarizeMonitoringOverlap(record, [cameraAt('boundary', 100), cameraAt('outside', 101)]);
    expect(overlap.within100m).toBe(1);
    expect(overlap.nearest).toEqual({ id: 'boundary', distanceM: 100 });
  });

  it('recomputes when the selected monitoring site changes', () => {
    const cameras = [cameraAt('same-place', 0)];
    const view = render(<MonitoringOverlap record={record} cameras={cameras} onOpenCamera={vi.fn()} />);
    expect(screen.getByText('Within 100 m').nextElementSibling).toHaveTextContent('1');
    view.rerender(<MonitoringOverlap record={core.destinationPoint(record.lat, record.lon, 0, 2000)} cameras={cameras} onOpenCamera={vi.fn()} />);
    expect(screen.getByText('Within 100 m').nextElementSibling).toHaveTextContent('0');
    expect(screen.getByText('Nearest loaded ALPR point').nextElementSibling).toHaveTextContent('2.0 km');
  });
});
