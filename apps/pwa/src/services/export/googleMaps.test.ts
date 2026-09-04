import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../db/schema.ts';

import {
  MY_MAPS_FEATURE_CAP,
  buildKml,
  escapeXml,
  exportNotice,
} from './googleMaps.ts';

function cameras(n: number): CameraRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `osm:${String(i)}`,
    lat: 38.9 + i * 0.0001,
    lon: -94.7 - i * 0.0001,
    directionDeg: 90,
    ownerType: 'unverified' as const,
    confirmations: 1,
  }));
}

describe('the google my maps export', () => {
  it('writes coordinates as lon,lat - KML is the one place that is reversed', () => {
    // Every other coordinate in this codebase is lat,lon. Getting this
    // backwards puts every camera in the wrong hemisphere.
    const { kml } = buildKml(cameras(1), { name: 'Johnson Co' });

    expect(kml).toContain('<coordinates>-94.7,38.9</coordinates>');
  });

  it('never hands over a silently truncated layer', () => {
    // My Maps takes 2,000 per layer and CUTS THE REST WITHOUT AN ERROR. For a
    // product whose argument is that an empty map is not a clear road, an
    // export that quietly stops partway is the worst thing this could do.
    const result = buildKml(cameras(2_500), { name: 'Harris Co' });

    expect(result.included).toBe(MY_MAPS_FEATURE_CAP);
    expect(result.omitted).toBe(500);
    expect(result.kml).toContain('left out');
  });

  it('says what was left out, in the notice a driver reads first', () => {
    const notice = exportNotice(buildKml(cameras(2_500), { name: 'Harris Co' }));

    expect(notice).toContain('500 were left out');
    expect(notice).toContain('cuts the rest without telling you');
  });

  it('states the limitation even when nothing was cut', () => {
    // The limitation that matters is not the cap - it is that this does not
    // draw over navigation. A driver who expects it to will trust the rest of
    // the product less, and would be right to.
    const notice = exportNotice(buildKml(cameras(3), { name: 'Johnson Co' }));

    expect(notice).toContain('does not draw over turn-by-turn navigation');
    expect(notice).not.toContain('left out');
  });

  it('keeps the ODbL credit inside the file, where it cannot be separated', () => {
    const { kml } = buildKml(cameras(2), { name: 'Johnson Co' });

    expect(kml).toContain('OpenStreetMap contributors');
    expect(kml).toContain('ODbL');
  });

  it('honours a caller’s ordering, so a cap keeps the nearest', () => {
    const far = { ...cameras(1)[0], id: 'osm:far' } as CameraRecord;
    const near = { ...cameras(1)[0], id: 'osm:near' } as CameraRecord;

    const result = buildKml([far, near], {
      name: 'Johnson Co',
      cap: 1,
      compare: (a, b) => (a.id === 'osm:near' ? -1 : b.id === 'osm:near' ? 1 : 0),
    });

    expect(result.kml).toContain('osm:near');
    expect(result.kml).not.toContain('osm:far');
  });

  it('escapes anything that would break the xml', () => {
    expect(escapeXml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; &quot;d&quot;');
  });

  it('names the file after the layer', () => {
    expect(buildKml(cameras(1), { name: 'Johnson Co, KS' }).filename).toBe('johnson-co-ks-alpr.kml');
  });
});
