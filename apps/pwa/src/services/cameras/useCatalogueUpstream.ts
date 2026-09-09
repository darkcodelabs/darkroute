/**
 * WHEN THE SERVED ARCHIVE WAS TRUE, AS REACT STATE, AND HOW OLD THAT MAKES IT.
 *
 * =============================================================================
 * WHY THIS EXISTS AT ALL
 * =============================================================================
 * The archive has always carried `upstream` - the OSM moment it represents -
 * and `catalogue.upstream()` has always returned it. Nothing on any screen has
 * ever shown it to a driver.
 *
 * On 2026-09-07 the served archive was six days old. The app said "139,918
 * cameras" and nothing else: no age, no warning, no way for anybody holding the
 * phone to know the readers on their map were a week out of date. The cause was
 * a scheduled sync switched off by a repository variable, and the reason it ran
 * for days without anybody noticing is that the product had no surface that
 * would have said so.
 *
 * A camera archive with a hidden age is the failure mode this whole app exists
 * to argue against. So the age is a first-class reading now, and DRIVE puts it
 * next to the count.
 *
 * =============================================================================
 * THE THRESHOLDS, AND WHY THEY ARE WHAT THEY ARE
 * =============================================================================
 * The sync consumes OSM's HOURLY replication stream (`scripts/sync-cameras.mjs`),
 * so "current" means hours rather than minutes and a couple of missed runs is
 * not a story.
 *
 *   LIVE     under 6 hours. Several hourly runs may be skipped or retried
 *            without this ever leaving green; that is normal operation of a
 *            volunteer-fed pipeline, not a fault worth alarming a driver over.
 *   BEHIND   6 to 48 hours. Something has stopped and has not come back, but
 *            the archive is still broadly true - readers do not move often.
 *   STALE    over 48 hours. Two full days of edits missing. At this point the
 *            map is making claims it cannot support and must say so.
 *
 * `unknown` is its own state, not folded into stale: a phone that has never
 * reached the network does not know how old its archive is, and telling that
 * driver "stale" would be asserting something we have not measured.
 */

import { useSyncExternalStore } from 'react';

import { catalogue } from './catalogue.ts';

export type ArchiveFreshness = 'live' | 'behind' | 'stale' | 'unknown';

/** Hours, from the design's own reading of an hourly replication stream. */
export const ARCHIVE_BEHIND_HOURS = 6;
export const ARCHIVE_STALE_HOURS = 48;

/** The ISO moment the served archive represents, or null while unknown. */
export function useCatalogueUpstream(): string | null {
  return useSyncExternalStore(
    (listener) => catalogue.subscribe(listener),
    () => catalogue.upstream(),
    // No server render; null is the honest answer for a render with no browser.
    () => null,
  );
}

/**
 * How far behind the archive is, in hours, or null when that is not knowable.
 *
 * Null rather than a large number for an unreadable timestamp: a value we could
 * not parse is not the same fact as an old one, and rounding the difference
 * between them away is how a display starts lying.
 */
export function archiveHoursBehind(
  upstreamIso: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (upstreamIso === null) return null;
  const upstreamMs = Date.parse(upstreamIso);
  if (!Number.isFinite(upstreamMs)) return null;
  const hours = (nowMs - upstreamMs) / 3_600_000;
  // A clock skewed slightly ahead of the publisher is not the future.
  return hours < 0 ? 0 : hours;
}

/**
 * The verdict the dot is painted from.
 *
 * Deliberately NOT a boolean. "Live or not" collapses the two absences - an
 * archive we know is old, and an archive whose age we have not learned - into
 * one colour, and those are different things to tell somebody who is driving.
 */
export function archiveFreshness(
  upstreamIso: string | null,
  nowMs: number = Date.now(),
): ArchiveFreshness {
  const hours = archiveHoursBehind(upstreamIso, nowMs);
  if (hours === null) return 'unknown';
  if (hours < ARCHIVE_BEHIND_HOURS) return 'live';
  if (hours < ARCHIVE_STALE_HOURS) return 'behind';
  return 'stale';
}

/**
 * '4 hours ago', '6 days ago', 'just now' - the age, in words.
 *
 * Whole units and no decimals: this is read at a glance beside a moving map,
 * and "5.7 hours" is a number somebody has to parse rather than a fact they can
 * take in. Precision that nobody can use is precision spent against
 * legibility.
 */
export function archiveAgeLabel(
  upstreamIso: string | null,
  nowMs: number = Date.now(),
): string | null {
  const hours = archiveHoursBehind(upstreamIso, nowMs);
  if (hours === null) return null;
  if (hours < 1) return 'just now';
  if (hours < 2) return '1 hour ago';
  if (hours < 48) return `${String(Math.floor(hours))} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}
