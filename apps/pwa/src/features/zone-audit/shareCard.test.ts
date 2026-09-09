/**
 * The share payload -- what actually leaves the device when SHARE CARD is
 * pressed.
 */

import { describe, expect, it } from 'vitest';

import { SHARE_CARD_TITLE, buildZoneSharePayload, shareCardText } from './shareCard.ts';
import type { ZoneStats } from './zone.ts';

const STATS: ZoneStats = {
  total: 47,
  police: 19,
  hoaPrivate: 28,
  sharedOutside: 31,
  facingInbound: 22,
  unclassified: 0,
};

const AT = new Date(2026, 7, 19, 9, 30).getTime();

describe('the payload', () => {
  it('goes out under the kind the share adapter already reserves for it', () => {
    const payload = buildZoneSharePayload({ stats: STATS, radiusMi: 2, atMs: AT });
    expect(payload.kind).toBe('zone-audit-card');
    expect(payload.title).toBe(SHARE_CARD_TITLE);
  });

  it('carries no link when no origin was configured, rather than a guessed one', () => {
    const payload = buildZoneSharePayload({ stats: STATS, radiusMi: 2, atMs: AT });
    expect(payload.url).toBeUndefined();
    expect(payload.text).not.toContain('http');
    expect(payload.text).not.toContain('.app');
    expect(payload.text).not.toContain('darkroute');
  });

  it('carries the link a build configured, and only that one', () => {
    const payload = buildZoneSharePayload({
      stats: STATS,
      radiusMi: 2,
      atMs: AT,
      origin: 'https://example.test ',
    });
    expect(payload.url).toBe('https://example.test');
  });

  it('shares no file, because nothing on this device can rasterise the card', () => {
    expect(buildZoneSharePayload({ stats: STATS, radiusMi: 2, atMs: AT }).files).toBeUndefined();
  });

  it('states the same numbers the card preview states, in the same order', () => {
    const text = shareCardText({ stats: STATS, radiusMi: 2, atMs: AT });
    expect(text).toContain('47 license plate readers within 2 miles.');
    expect(text).toContain('POLICE-OWNED 19');
    expect(text).toContain('HOA / PRIVATE 28');
    expect(text).toContain('SHARED TO OUTSIDE AGENCIES 31');
    expect(text).toContain('FACING INBOUND TRAFFIC 22');
    expect(text).toContain('COMMUNITY-REPORTED · AUG 19 2026');
    expect(text.indexOf('POLICE-OWNED')).toBeLessThan(text.indexOf('HOA / PRIVATE'));
  });

  it('carries no plate and no coordinate', () => {
    const text = shareCardText({
      stats: STATS,
      radiusMi: 2,
      atMs: AT,
      place: 'Hartwell Elementary',
    });
    expect(text.toLowerCase()).not.toContain('plate readers'.replace('readers', 'number'));
    expect(text).toContain('license plate readers');
    expect(text).not.toMatch(/-?\d{2}\.\d{3,}/);
  });
});
