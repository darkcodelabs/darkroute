import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MonitoringRecord } from '../../../../packages/core/src/roadMonitoring.ts';
import { IMAGE_MAX_BYTES, IMAGE_TIMEOUT_MS, officialImageUrl, onRequestGet } from './image.ts';

const DATE = '2026-09-10T00:00:00Z';
const OP = 'https://www2.opkansas.org/external-files/traffic-cameras/151st_Conser_W.jpeg';
const CALTRANS = 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const entry = (patch: Partial<MonitoringRecord> = {}): MonitoringRecord => ({
  id: 'op:1', sourceId: 'overland-park-traffic', kind: 'traffic_camera', lat: 38.9, lon: -94.6,
  name: '151st and Conser', operator: 'City of Overland Park', road: '151st St', direction: 'W',
  status: 'unknown', sourceUrl: 'https://maps.opkansas.org/traffic-cameras-map/', imageUrl: OP,
  sourceUpdatedAt: null, ...patch,
});
const inventory = (patch: Partial<MonitoringRecord> = {}) => {
  const record = entry(patch);
  return new Response(JSON.stringify({ schema: 'darkroute-road-monitoring/v1', generatedAt: DATE,
    sources: [{ id: record.sourceId, name: 'Official inventory', url: 'https://example.org/', attribution: 'Transport department',
      licence: null, licenceUrl: null, coverage: 'Public roads', checkedAt: DATE, fetchedAt: DATE, sourceUpdatedAt: null, status: 'ok', count: 1 }],
    records: [record],
  }));
};
const invoke = (query = '?id=op%3A1') => onRequestGet({ request: new Request(`https://darkroute.ai/api/v1/monitoring/image${query}`, {
  headers: { cookie: 'private=value', authorization: 'Bearer private', referer: 'https://darkroute.ai/?position=private' },
}) } as never) as Promise<Response>;
afterEach(() => vi.restoreAllMocks());

describe('official inventory image proxy', () => {
  it('resolves a known id and fetches only its pinned official image without forwarding viewer headers', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(inventory())
      .mockResolvedValueOnce(new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }));
    const response = await invoke();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [target, init] = fetcher.mock.calls[1]!;
    expect(target).toBe(OP);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { accept: 'image/jpeg, image/png, image/webp' } });
    expect(Object.keys(init?.headers ?? {})).toEqual(['accept']);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(IMAGE_TIMEOUT_MS).toBe(10_000);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
  });

  it('pins the source id, protocol, host, district and path using real inventory URL shapes', () => {
    const credentialUrl = new URL(OP);
    credentialUrl.username = 'fixture-user';
    credentialUrl.password = 'fixture-password';
    expect(officialImageUrl(entry())).toBe(OP);
    expect(officialImageUrl(entry({ sourceId: 'caltrans-d7', imageUrl: CALTRANS }))).toBe(CALTRANS);
    for (const patch of [
      { imageUrl: 'https://www2.opkansas.org.evil.example/external-files/traffic-cameras/test.jpeg' },
      { imageUrl: 'http://www2.opkansas.org/external-files/traffic-cameras/test.jpeg' },
      { imageUrl: 'https://www2.opkansas.org/private/test.jpeg' },
      { imageUrl: 'https://www2.opkansas.org/external-files/traffic-cameras/%252e%252e/test.jpeg' },
      { imageUrl: credentialUrl.href },
      { imageUrl: CALTRANS }, { sourceId: 'caltrans-d8', imageUrl: CALTRANS },
      { sourceId: 'unlisted-source' }, { kind: 'bluetooth_sensor' as const },
    ]) expect(officialImageUrl(entry(patch))).toBeNull();
  });

  it('never accepts an arbitrary target URL and never requests images for unknown or unavailable records', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect((await invoke('?url=https://example.org/image.jpg')).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(inventory());
    expect((await invoke('?id=unknown')).status).toBe(404);
    fetcher.mockResolvedValueOnce(inventory({ imageUrl: null }));
    expect((await invoke()).status).toBe(404);
    fetcher.mockResolvedValueOnce(inventory({ imageUrl: 'https://example.org/image.jpg' }));
    expect((await invoke()).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('refuses redirects without requesting their target', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(inventory())
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    const response = await invoke();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'image_source_refused' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requires a supported raster MIME type with matching magic bytes', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const [body, mime] of [
      ['<svg onload="alert(1)"></svg>', 'image/svg+xml'], ['<html>error</html>', 'image/jpeg'],
      [JPEG, 'text/html'], [JPEG, 'image/png'],
    ] as const) {
      fetcher.mockResolvedValueOnce(inventory()).mockResolvedValueOnce(new Response(body, { headers: { 'content-type': mime } }));
      expect((await invoke()).status).toBe(502);
    }
    for (const [body, mime] of [
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
      [new TextEncoder().encode('RIFF0000WEBP'), 'image/webp'],
    ] as const) {
      fetcher.mockResolvedValueOnce(inventory()).mockResolvedValueOnce(new Response(body, { headers: { 'content-type': mime } }));
      expect((await invoke()).status).toBe(200);
    }
  });

  it('bounds both declared and streamed image bytes and reports network failures', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(inventory()).mockResolvedValueOnce(new Response(JPEG, {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(IMAGE_MAX_BYTES + 1) },
    }));
    expect((await invoke()).status).toBe(502);
    fetcher.mockResolvedValueOnce(inventory()).mockResolvedValueOnce(new Response(new Uint8Array(IMAGE_MAX_BYTES + 1), { headers: { 'content-type': 'image/jpeg' } }));
    expect((await invoke()).status).toBe(502);
    fetcher.mockResolvedValueOnce(inventory()).mockRejectedValueOnce(new Error('timed out'));
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
