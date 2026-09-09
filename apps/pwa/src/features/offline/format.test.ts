import { describe, expect, it } from 'vitest';

import { NO_VALUE, dbAgeWarning, formatCacheCount, formatDbAge } from './format.ts';
import type { DbAgeWarningInput } from './format.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('cache counters', () => {
  it('renders the two figures A2 draws', () => {
    expect(formatCacheCount(4182)).toBe('4,182');
    expect(formatCacheCount(318)).toBe('318');
  });

  it('groups every thousand, however large the cache gets', () => {
    expect(formatCacheCount(1000)).toBe('1,000');
    expect(formatCacheCount(999)).toBe('999');
    expect(formatCacheCount(1234567)).toBe('1,234,567');
  });

  it('prints a real zero as zero, and an unknown count as an em dash', () => {
    // A cache that was read and holds nothing is a fact worth stating.
    expect(formatCacheCount(0)).toBe('0');
    // A cache that has not been read yet is not a cache holding zero.
    expect(formatCacheCount(null)).toBe(NO_VALUE);
    expect(formatCacheCount(Number.NaN)).toBe(NO_VALUE);
  });
});

describe('database age', () => {
  it('renders the phrase A2 draws', () => {
    expect(formatDbAge(2 * DAY)).toBe('2 days');
  });

  it('drops to hours and minutes rather than printing a fraction of a day', () => {
    expect(formatDbAge(3 * HOUR)).toBe('3 hours');
    expect(formatDbAge(45 * MINUTE)).toBe('45 minutes');
    expect(formatDbAge(20_000)).toBe('less than a minute');
  });

  it('says one thing in the singular', () => {
    expect(formatDbAge(DAY)).toBe('1 day');
    expect(formatDbAge(HOUR)).toBe('1 hour');
    expect(formatDbAge(MINUTE)).toBe('1 minute');
  });

  it('never reports an age from a clock that moved backwards', () => {
    expect(formatDbAge(-3 * HOUR)).toBe('less than a minute');
  });

  it('has no age to report when nothing was ever checked', () => {
    expect(formatDbAge(null)).toBeNull();
  });
});

describe('the warning sentence', () => {
  /** The device A2 draws: a filled cache, checked two days ago, on real storage. */
  function a2(over: Partial<DbAgeWarningInput> = {}): DbAgeWarningInput {
    return {
      ageMs: 2 * DAY,
      storageAvailable: true,
      cachedCameras: 4182,
      cachedAgeMs: 2 * DAY,
      storageReason: null,
      ...over,
    };
  }

  it('is verbatim from A2 when the database has an age', () => {
    expect(dbAgeWarning(a2())).toEqual({
      kind: 'aged',
      text:
        'DB last updated 2 days ago. Cameras added since then are invisible - ' +
        'treat clear as probably clear.',
      detail: null,
    });
  });

  it('refuses to claim a check that never happened', () => {
    const warning = dbAgeWarning(a2({ ageMs: null, cachedCameras: 0, cachedAgeMs: null }));

    expect(warning.kind).toBe('never-checked');
    expect(warning.text).not.toContain('last updated');
    expect(warning.text).toContain('never been checked');
  });

  it('never says nothing is cached while cameras are cached', () => {
    // `cameraTiles.put()` writes the tile body and no `tileMeta` row, so a
    // cache filled through the repository's own write API has cameras in it
    // and no check time at all. The screen may not call that empty.
    const warning = dbAgeWarning(a2({ ageMs: null, cachedCameras: 4182, cachedAgeMs: 2 * DAY }));

    expect(warning.kind).toBe('unchecked');
    expect(warning.text).not.toContain('Nothing is cached');
    expect(warning.text).toContain('never been checked');
    // The fetch time is the only age an unchecked cache has, and it is stated
    // as a fetch, never as a check against the source.
    expect(warning.text).toContain('stored 2 days ago');
    expect(warning.text).not.toContain('last updated');
  });

  it('admits it cannot even date the copy when nothing was fetched either', () => {
    const warning = dbAgeWarning(a2({ ageMs: null, cachedCameras: 12, cachedAgeMs: null }));

    expect(warning.kind).toBe('unchecked');
    expect(warning.text).not.toContain('Nothing is cached');
    expect(warning.text).toContain('never been verified');
  });

  it('does not call an unread count an empty cache', () => {
    // `null` is "the read has not landed", which is not zero.
    const warning = dbAgeWarning(a2({ ageMs: null, cachedCameras: null, cachedAgeMs: null }));

    expect(warning.kind).toBe('unchecked');
    expect(warning.text).not.toContain('Nothing is cached');
  });

  it('says storage is gone rather than blaming the network for it', () => {
    const warning = dbAgeWarning(a2({ storageAvailable: false }));

    expect(warning.kind).toBe('no-storage');
    expect(warning.text).toContain('Local storage is unavailable');
    // The age is real but meaningless without a store to hold the tiles.
    expect(warning.text).not.toContain('2 days');
  });

  it('carries the reason the database layer gave, and only for the no-storage case', () => {
    const reason = 'this browser exposes no IndexedDB, so nothing is cached on this device';

    expect(dbAgeWarning(a2({ storageAvailable: false, storageReason: reason })).detail).toBe(
      reason,
    );
    // A working database has no failure to explain.
    expect(dbAgeWarning(a2({ storageReason: reason })).detail).toBeNull();
  });

  it('says a refused cache is refused rather than dating it', () => {
    // THE SENTENCE THAT WAS MISSING. A cache mixed across two generations is
    // refused whole by `hydrateTiles`, so the counters beside this read zero --
    // and "DB has never been checked ... Nothing is cached" would send a driver
    // looking for a sync that already happened, over a disk that is full.
    const warning = dbAgeWarning(
      a2({ ageMs: null, cachedCameras: 0, cachedAgeMs: null, incoherence: 'mixed' }),
    );

    expect(warning.kind).toBe('mixed');
    expect(warning.text).toContain('more than one published snapshot');
    expect(warning.text).not.toContain('Nothing is cached');
  });

  it('outranks the age with the mixture, because the age is of rows nothing will load', () => {
    // A perfectly good "2 days ago" computed over rows that are not being used
    // is the reassuring half of the truth.
    const warning = dbAgeWarning(a2({ incoherence: 'mixed' }));

    expect(warning.kind).toBe('mixed');
    expect(warning.text).not.toContain('2 days');
  });

  it('says the cache aged out when age is the only reason nothing is usable', () => {
    const warning = dbAgeWarning(
      a2({ ageMs: null, cachedCameras: 0, cachedAgeMs: null, incoherence: 'expired' }),
    );

    expect(warning.kind).toBe('expired');
    expect(warning.text).toContain('past the age this app will trust');
  });

  it('still dates the rows that survived a partial expiry', () => {
    // Some rows aged out, plenty did not. The usable ones have a real age and
    // the drawn sentence is the right one for them.
    const warning = dbAgeWarning(a2({ incoherence: 'expired' }));

    expect(warning.kind).toBe('aged');
    expect(warning.text).toContain('2 days');
  });

  it('says the disk is a generation behind the warnings, when it is', () => {
    // `sync.ts` admits a verified network generation to memory even when the
    // durable replacement conflicts. Both copies are internally sound and they
    // are not the same snapshot; a restart with no signal gets the older one.
    const warning = dbAgeWarning(a2({ behindLiveGeneration: true }));

    expect(warning.kind).toBe('behind');
    expect(warning.text).toContain('older published snapshot');
    expect(warning.text).toContain('Alerts are current');
  });

  it('does not say the disk is behind when it is not', () => {
    expect(dbAgeWarning(a2({ behindLiveGeneration: false })).kind).toBe('aged');
    expect(dbAgeWarning(a2()).kind).toBe('aged');
  });
});
