import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonitoringDetail } from './MonitoringDetail.tsx';
import { monitoringRecordFixture as record, monitoringSourceFixture as source } from '../../services/records/monitoringFixture.ts';

describe('infrastructure details', () => {
  it('explains Bluetooth travel-time matching with a source and avoids implying a missing licence', () => {
    render(<MonitoringDetail record={record} source={{ ...source, licence: null }} cameras={[]} onOpenCamera={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/This inventory contains equipment locations only, with no captured identifiers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How Bluetooth monitoring works (DelDOT)' })).toHaveAttribute('href', 'https://deldot.gov/Programs/itms/index.shtml?dc=technology');
    expect(screen.getByRole('link', { name: 'Source terms and information' })).toHaveAttribute('href', source.licenceUrl);
  });

  it('shows unknown technology and distinct publisher/source check dates without a photo request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const close = vi.fn();
    render(<MonitoringDetail record={{ ...record, kind: 'probe_sensor', status: 'unknown' }} source={source} cameras={[]} onOpenCamera={() => {}} onClose={close} />);
    expect(screen.getByRole('heading', { name: 'Travel-time probes' })).toBeInTheDocument();
    expect(screen.getByText(/Status not reported · inventory record/)).toBeInTheDocument();
    expect(screen.getByText(/does not identify its technology as Bluetooth/)).toBeInTheDocument();
    expect(screen.getByText('Source updated').nextElementSibling).toHaveTextContent('Aug 1, 2026');
    expect(screen.getByText('Source checked').nextElementSibling).toHaveTextContent('Sep 10, 2026');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close road monitoring details' }), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('fetches only the selected photo through the proxy and aborts/releases it on close', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetch);
    const create = vi.fn().mockReturnValue('blob:photo');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = revoke; });
    const view = render(<MonitoringDetail record={{ ...record, imageUrl: 'https://publisher.test/photo.jpg' }} source={source} cameras={[]} onOpenCamera={() => {}} onClose={() => {}} />);
    await screen.findByRole('img');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/monitoring/image?id=sensor-one', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
    const signal = (fetch.mock.calls[0]?.[1] as RequestInit).signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:photo');
  });
  it('says when a published camera photo is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    render(<MonitoringDetail record={{ ...record, imageUrl: 'https://publisher.test/photo.jpg' }} source={source} cameras={[]} onOpenCamera={() => {}} onClose={() => {}} />);
    await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('Camera photo is unavailable'); });
  });
});
