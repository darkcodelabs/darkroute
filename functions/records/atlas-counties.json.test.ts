import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ATLAS_KEY } from '../api/v1/_atlasSnapshot.ts';
import { onRequestGet, onRequestHead } from './atlas-counties.json.ts';

const snapshot = readFileSync(new URL('../../apps/pwa/public/records/atlas-counties.json', import.meta.url), 'utf8');
const invoke = (env: unknown, next = vi.fn(async () => new Response(snapshot))) =>
  onRequestGet({ env, next, request: new Request('https://darkroute.ai/records/atlas-counties.json') } as never) as Promise<Response>;

describe('shared live Atlas artifact', () => {
  it('answers HEAD with JSON headers and no body, including before the first R2 publication', async () => {
    const next = vi.fn(async () => new Response(snapshot));
    const response = await onRequestHead({ env: {}, next, request: new Request('https://darkroute.ai/records/atlas-counties.json', { method: 'HEAD' }) } as never) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).toBe('');
    expect((next.mock.calls as unknown as [Request][])[0]?.[0].method).toBe('GET');
  });
  it('prefers the published object and keeps its retrieval timestamp and ETag', async () => {
    const get = vi.fn(async () => ({ size: snapshot.length, text: async () => snapshot, httpEtag: '"atlas"' }));
    const next = vi.fn();
    const response = await invoke({ CAMERA_TILES: { get } }, next);
    expect(get).toHaveBeenCalledWith(ATLAS_KEY);
    expect(next).not.toHaveBeenCalled();
    expect(response.headers.get('x-darkroute-atlas-source')).toBe('r2');
    expect(response.headers.get('etag')).toBe('"atlas"');
    expect(await response.text()).toBe(snapshot);
  });

  it('uses a clearly marked static artifact only until a live object exists', async () => {
    for (const env of [{}, { CAMERA_TILES: { get: async () => null } }]) {
      const response = await invoke(env);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-darkroute-atlas-source')).toBe('static');
    }
  });

  it('never masks storage failure or a malformed live snapshot with a static copy', async () => {
    for (const get of [async () => { throw new Error('down'); }, async () => ({ size: 2, text: async () => '{}' })]) {
      const next = vi.fn();
      const response = await invoke({ CAMERA_TILES: { get } }, next);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(next).not.toHaveBeenCalled();
    }
  });
});
