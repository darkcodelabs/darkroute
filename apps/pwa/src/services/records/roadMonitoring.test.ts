import { describe, expect, it, vi } from 'vitest';
import { createMonitoringStore, fetchMonitoring, MONITORING_REFRESH_MS } from './roadMonitoring.ts';
import { MONITORING_MAX_BYTES } from '../../stores/fwmCore.ts';
import { monitoringSnapshotFixture as snapshot } from './monitoringFixture.ts';

describe('road monitoring feed', () => {
  it('requests one public inventory without reader information', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchMonitoring()).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/records/road-monitoring.json', {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
  });
  it('rejects malformed snapshots, oversized headers, and oversized streamed bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ ...snapshot, schema: 'other' }))
      .mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': String(MONITORING_MAX_BYTES + 1) } }))
      .mockResolvedValueOnce(new Response('x'.repeat(MONITORING_MAX_BYTES + 1))));
    await expect(fetchMonitoring()).rejects.toThrow('Invalid inventory');
    await expect(fetchMonitoring()).rejects.toThrow('Inventory too large');
    await expect(fetchMonitoring()).rejects.toThrow('Inventory too large');
  });
  it('deduplicates refreshes and preserves the last good inventory on failure', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1);
    const read = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot);
    const feed = createMonitoringStore(read);
    expect(read).not.toHaveBeenCalled();
    const pending = feed.refreshIfStale();
    expect(feed.refreshIfStale()).toBe(pending);
    await pending;
    await feed.refreshIfStale();
    expect(read).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1 + MONITORING_REFRESH_MS);
    await feed.refreshIfStale();
    expect(feed.getSnapshot()).toMatchObject({ data: snapshot, loading: false, error: 'Could not refresh road monitoring.' });
    await feed.refreshIfStale();
    expect(read).toHaveBeenCalledTimes(2);
    await feed.refresh();
    expect(feed.getSnapshot().error).toBeNull();
  });
});
