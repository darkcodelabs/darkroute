import { describe, expect, it, vi } from 'vitest';
import { MONITORING_MAX_BYTES } from '../../packages/core/src/roadMonitoring.ts';
import { MONITORING_KEY } from '../api/v1/_monitoringSnapshot.ts';
import { onRequestGet, onRequestHead } from './road-monitoring.json.ts';

const snapshot = JSON.stringify({ schema: 'darkroute-road-monitoring/v1', generatedAt: '2026-09-10T00:00:00Z', sources: [], records: [] });
const object = (body = snapshot) => ({ size: body.length, httpEtag: '"inventory"', body: new Response(body).body });
const context = (env: unknown, method = 'GET', next = vi.fn(async () => new Response(snapshot))) => ({
  env, next, request: new Request('https://darkroute.ai/records/road-monitoring.json', { method }),
});

describe('shared published road monitoring snapshot', () => {
  it('reads only the independent R2 key and returns a marked, bounded, validated snapshot', async () => {
    const get = vi.fn(async () => object());
    const ctx = context({ CAMERA_TILES: { get } });
    const response = await onRequestGet(ctx as never) as Response;
    expect(get).toHaveBeenCalledWith(MONITORING_KEY);
    expect(ctx.next).not.toHaveBeenCalled();
    expect(response.headers.get('x-darkroute-monitoring-source')).toBe('r2');
    expect(response.headers.get('etag')).toBe('"inventory"');
    expect(await response.json()).toEqual(JSON.parse(snapshot));
  });

  it('falls back to the packaged inventory only when no live object exists, including HEAD', async () => {
    for (const env of [{}, { CAMERA_TILES: { get: async () => null } }]) {
      const ctx = context(env, 'HEAD');
      const response = await onRequestHead(ctx as never) as Response;
      expect(response.status).toBe(200);
      expect(response.headers.get('x-darkroute-monitoring-source')).toBe('static');
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.text()).toBe('');
    }
  });

  it('never substitutes packaged data for storage failure, invalid live data or an oversized object', async () => {
    for (const get of [async () => { throw new Error('storage'); }, async () => object('{}'), async () => ({ ...object(), size: MONITORING_MAX_BYTES + 1 })]) {
      const ctx = context({ CAMERA_TILES: { get } });
      const response = await onRequestGet(ctx as never) as Response;
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(ctx.next).not.toHaveBeenCalled();
    }
  });

  it('stops reading an oversized stream even when its declared size is small', async () => {
    const ctx = context({ CAMERA_TILES: { get: async () => ({ size: 1, httpEtag: '"bad"', body: new Response('x'.repeat(MONITORING_MAX_BYTES + 1)).body }) } });
    expect((await onRequestGet(ctx as never) as Response).status).toBe(503);
  });
});
