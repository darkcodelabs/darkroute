import { describe, expect, it } from 'vitest'

import type { LookupRecord } from './quota.ts'
import { DEFAULT_LOOKUP_QUOTA, checkLookupQuota, recordLookup } from './quota.ts'

const NOW = 1_755_000_000_000 // fixed instant; the clock is an argument, never read from the host
const DAY = 24 * 60 * 60 * 1000
const MINE = 'a1b2c3d4e5f60718'
const PARTNER = 'ff00ff00ff00ff00'

function at(offsetMs: number, blindIndex = MINE): LookupRecord {
  return { blindIndex, at: NOW + offsetMs }
}

describe('checkLookupQuota', () => {
  it('allows the first lookup and counts down', () => {
    const d = checkLookupQuota({ history: [], blindIndex: MINE, now: NOW })
    expect(d.allowed).toBe(true)
    if (d.allowed) {
      expect(d.remainingToday).toBe(DEFAULT_LOOKUP_QUOTA.perDay)
      expect(d.remainingThisMonth).toBe(DEFAULT_LOOKUP_QUOTA.perMonth)
    }
  })

  it('refuses the fourth lookup in a day', () => {
    const history = [at(-3 * 60_000), at(-2 * 60_000), at(-60_000)]
    const d = checkLookupQuota({ history, blindIndex: MINE, now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).toBe('daily')
      expect(d.message).toContain('3 lookups a day')
    }
  })

  it('uses a rolling window, not a calendar day', () => {
    // Three lookups just over 24h ago must not count against today. A calendar
    // reset would invite sitting on the boundary and bursting at midnight.
    const history = [at(-DAY - 60_000), at(-DAY - 120_000), at(-DAY - 180_000)]
    expect(checkLookupQuota({ history, blindIndex: MINE, now: NOW }).allowed).toBe(true)
  })

  it('tells the user when they can retry, not just that they cannot', () => {
    const oldest = at(-2 * 60 * 60 * 1000) // 2h ago
    const history = [oldest, at(-60_000), at(-30_000)]
    const d = checkLookupQuota({ history, blindIndex: MINE, now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.retryAt).toBe(oldest.at + DAY)
      expect(d.message).toMatch(/in \d+ hours?/)
    }
  })

  it('lets you re-check a plate you have already checked', () => {
    // The legitimate use is a worried person checking their own vehicle again.
    // Counting a repeat against the distinct-plate ceiling would punish exactly
    // the person the feature exists for.
    const history = [
      at(-10 * DAY, MINE),
      at(-9 * DAY, PARTNER),
      at(-8 * DAY, 'aaaa000000000000'),
      at(-7 * DAY, 'bbbb000000000000'),
      at(-6 * DAY, 'cccc000000000000'),
    ]
    expect(history.length).toBe(DEFAULT_LOOKUP_QUOTA.distinctPlatesPerMonth)
    const d = checkLookupQuota({ history, blindIndex: MINE, now: NOW })
    expect(d.allowed).toBe(true)
  })

  it('refuses a sixth distinct plate in a month', () => {
    const history = [
      at(-10 * DAY, MINE),
      at(-9 * DAY, PARTNER),
      at(-8 * DAY, 'aaaa000000000000'),
      at(-7 * DAY, 'bbbb000000000000'),
      at(-6 * DAY, 'cccc000000000000'),
    ]
    const d = checkLookupQuota({ history, blindIndex: 'dddd000000000000', now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).toBe('distinct-plates')
      expect(d.message).toContain('not for looking up other people')
    }
  })

  it('daily limit outranks the distinct-plate limit', () => {
    // Both are breached; the message should name the one that resets soonest,
    // otherwise the user is told to wait a month when they could wait an hour.
    const history = [
      at(-10 * DAY, 'aaaa000000000000'),
      at(-9 * DAY, 'bbbb000000000000'),
      at(-8 * DAY, 'cccc000000000000'),
      at(-7 * DAY, 'dddd000000000000'),
      at(-60_000, MINE),
      at(-50_000, MINE),
      at(-40_000, MINE),
    ]
    const d = checkLookupQuota({ history, blindIndex: 'eeee000000000000', now: NOW })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('daily')
  })

  it('honours a custom policy', () => {
    const policy = { perDay: 1, perMonth: 1, distinctPlatesPerMonth: 1 }
    const d = checkLookupQuota({ history: [at(-60_000)], blindIndex: MINE, now: NOW, policy })
    expect(d.allowed).toBe(false)
  })
})

describe('recordLookup', () => {
  it('appends and prunes beyond the widest window', () => {
    const stale = at(-40 * DAY)
    const fresh = at(-DAY)
    const next = recordLookup([stale, fresh], at(0))
    expect(next).toHaveLength(2)
    expect(next.some((r) => r.at === stale.at)).toBe(false)
  })

  it('stores no plate - only a blind index and a time', () => {
    const next = recordLookup([], at(0))
    expect(Object.keys(next[0] ?? {}).sort()).toEqual(['at', 'blindIndex'])
  })
})
