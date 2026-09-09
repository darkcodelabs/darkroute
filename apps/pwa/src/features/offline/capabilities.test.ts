/**
 * The five WHAT STILL WORKS rows, resolved rather than asserted.
 *
 * Every test here is about the design's picture being WRONG for some real
 * device, which is the whole reason this module exists.
 */

import { describe, expect, it } from 'vitest';

import { CAPABILITY_ORDER, resolveCapabilities } from './capabilities.ts';
import type { CapabilityVerdict, OfflineCapabilityId, OfflineCapabilityInput } from './capabilities.ts';

/** The phone A2 draws: no network, full cache, working storage. */
function a2(over: Partial<OfflineCapabilityInput> = {}): OfflineCapabilityInput {
  return {
    online: false,
    reachable: null,
    presence: 'offline',
    storage: 'available',
    cachedCameras: 4182,
    ...over,
  };
}

function verdicts(
  input: OfflineCapabilityInput,
): Readonly<Record<OfflineCapabilityId, CapabilityVerdict>> {
  const out: Partial<Record<OfflineCapabilityId, CapabilityVerdict>> = {};
  for (const capability of resolveCapabilities(input)) out[capability.id] = capability.verdict;
  return out as Record<OfflineCapabilityId, CapabilityVerdict>;
}

describe('the phone the design drew', () => {
  it('resolves to exactly the five verdicts A2 renders', () => {
    expect(verdicts(a2())).toEqual({
      'cached-alerts': 'ok',
      'local-tools': 'ok',
      'queued-reports': 'ok',
      mesh: 'no',
      ask: 'no',
    });
  });

  it('renders the rows in the order and wording A2 renders them', () => {
    const rows = resolveCapabilities(a2());

    expect(rows.map((row) => row.id)).toEqual([...CAPABILITY_ORDER]);
    expect(rows.map((row) => row.label)).toEqual([
      'alerts from cached cameras',
      'sweep, lookup, exposure log',
      'reporting - queues locally',
      'mesh feed, other darkroute',
      'ask - needs the model',
    ]);
  });
});

describe('an empty cache is not a working radar', () => {
  it('says NO to cached alerts when there is nothing cached', () => {
    expect(verdicts(a2({ cachedCameras: 0 }))['cached-alerts']).toBe('no');
  });

  it('keeps the local tools and the report queue working with an empty cache', () => {
    const rows = verdicts(a2({ cachedCameras: 0 }));

    expect(rows['local-tools']).toBe('ok');
    expect(rows['queued-reports']).toBe('ok');
  });
});

describe('no local storage', () => {
  it('takes down the three rows the design draws OK', () => {
    const rows = verdicts(a2({ storage: 'unavailable', cachedCameras: null }));

    expect(rows['cached-alerts']).toBe('no');
    expect(rows['local-tools']).toBe('no');
    expect(rows['queued-reports']).toBe('no');
  });
});

describe('before the cache has answered', () => {
  it('reports the storage-backed rows as unknown rather than guessing either way', () => {
    const rows = verdicts(a2({ storage: 'unknown', cachedCameras: null }));

    expect(rows['cached-alerts']).toBe('unknown');
    expect(rows['local-tools']).toBe('unknown');
    expect(rows['queued-reports']).toBe('unknown');
    // The two network rows do not depend on the cache and answer immediately.
    expect(rows.mesh).toBe('no');
    expect(rows.ask).toBe('no');
  });
});

describe('the two rows the design draws NO can come back', () => {
  it('turns the mesh feed on only when the presence slice is actually live', () => {
    expect(verdicts(a2({ presence: 'live', online: true })).mesh).toBe('ok');
    // Every other presence verdict is a dark feed, whatever the network says.
    expect(verdicts(a2({ presence: 'disabled', online: true })).mesh).toBe('no');
    expect(verdicts(a2({ presence: 'unavailable', online: true })).mesh).toBe('no');
    expect(verdicts(a2({ presence: 'offline', online: true })).mesh).toBe('no');
  });

  it('turns ask on when the network is back', () => {
    expect(verdicts(a2({ online: true })).ask).toBe('ok');
  });

  it('keeps ask off when a request has actually failed, whatever the OS claims', () => {
    // A captive portal reads as online and answers nothing.
    expect(verdicts(a2({ online: true, reachable: false })).ask).toBe('no');
  });
});
