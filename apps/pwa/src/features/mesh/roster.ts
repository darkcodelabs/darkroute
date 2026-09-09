/**
 * THE NODE ROSTER: counting, filtering and ordering what the radio has heard.
 *
 * =============================================================================
 * WHY THIS IS A MODULE AND NOT A `.filter()` IN A COMPONENT
 * =============================================================================
 * A roster of 168 nodes is only useful if the ordering means something, and
 * every ordering here encodes a judgement that is easy to get quietly wrong:
 * what counts as "online", whether a node with no signal report sorts as good
 * or bad, whether an MQTT-bridged node counts as nearby. Those are testable
 * decisions, so they live somewhere they can be tested.
 *
 * =============================================================================
 * ONLINE IS A CLAIM, SO IT HAS A DEFINITION
 * =============================================================================
 * Meshtastic nodes do not announce that they left. A roster entry persists in
 * the node database long after the node is out of range, which means "168
 * nodes" is a count of what has EVER been heard, not what is out there now.
 *
 * `ONLINE_WINDOW_S` is the line, and it is drawn at fifteen minutes because
 * that is a common `NodeInfo` broadcast interval - a node heard inside one
 * interval is plausibly still there, and one that has missed several is not.
 * Nothing here says "offline"; the roster says how long ago, and lets the
 * driver decide.
 */

import type { MeshNode } from '../node/mesh.ts';

/** Heard within this many seconds counts as online. See the header. */
export const ONLINE_WINDOW_S = 15 * 60;

export type RosterSort = 'heard' | 'signal' | 'hops' | 'name';

export const ROSTER_SORTS: readonly RosterSort[] = ['heard', 'signal', 'hops', 'name'];

export const SORT_LABEL: Readonly<Record<RosterSort, string>> = {
  heard: 'RECENT',
  signal: 'SIGNAL',
  hops: 'NEAREST',
  name: 'NAME',
};

export interface RosterCounts {
  readonly online: number;
  readonly shown: number;
  readonly total: number;
}

/**
 * `57 online · 168 shown · 168 total`.
 *
 * Three numbers rather than one because they answer different questions and
 * routinely disagree: how much of the mesh is live, how much the current filter
 * is hiding, and how much the radio has ever met.
 */
export function rosterCounts(
  all: readonly MeshNode[],
  shown: readonly MeshNode[],
  nowMs: number,
): RosterCounts {
  const nowS = Math.round(nowMs / 1000);
  let online = 0;
  for (const node of all) {
    if (node.lastHeard !== null && nowS - node.lastHeard <= ONLINE_WINDOW_S) online += 1;
  }
  return { online, shown: shown.length, total: all.length };
}

/** Whether a node was heard recently enough to call live. */
export function isOnline(node: MeshNode, nowMs: number): boolean {
  if (node.lastHeard === null) return false;
  return Math.round(nowMs / 1000) - node.lastHeard <= ONLINE_WINDOW_S;
}

/**
 * Free-text match across every field a person would actually type.
 *
 * Includes the node id, because `!a0cccf24` is how Meshtastic prints a node and
 * is often the only handle an unnamed node has.
 */
export function matchesQuery(node: MeshNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [node.name, node.shortName, node.id, node.hardware, node.role].some(
    (field) => field !== null && field.toLowerCase().includes(q),
  );
}

/**
 * Sort a copy, never in place.
 *
 * NULL SORTS LAST IN EVERY MODE, and that is the rule worth stating: a node
 * that has not reported an SNR is not a node with a bad SNR, and letting
 * "unknown" collapse into "worst" would put silent nodes at the top of a list
 * whose whole job is to show the driver what is actually reachable.
 */
export function sortRoster(nodes: readonly MeshNode[], sort: RosterSort): readonly MeshNode[] {
  const copy = [...nodes];
  const nullsLast = (a: number | null, b: number | null, better: (x: number, y: number) => number) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return better(a, b);
  };

  switch (sort) {
    case 'heard':
      return copy.sort((a, b) => nullsLast(a.lastHeard, b.lastHeard, (x, y) => y - x));
    case 'signal':
      return copy.sort((a, b) => nullsLast(a.snr, b.snr, (x, y) => y - x));
    case 'hops':
      return copy.sort((a, b) => nullsLast(a.hopsAway, b.hopsAway, (x, y) => x - y));
    case 'name':
      return copy.sort((a, b) => {
        // An unnamed node falls back to its id rather than to the empty string,
        // which would cluster every anonymous node at the top under nothing.
        const an = (a.name ?? a.id).toLowerCase();
        const bn = (b.name ?? b.id).toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
  }
}

/** Filter then sort, which is the order the screen needs and the cheaper one. */
export function buildRoster(
  nodes: readonly MeshNode[],
  query: string,
  sort: RosterSort,
): readonly MeshNode[] {
  return sortRoster(
    nodes.filter((node) => matchesQuery(node, query)),
    sort,
  );
}

/** `4h`, `12m`, `now`, or the dash. The radio's clock, so it survives a restart. */
export function heardAgo(lastHeard: number | null, nowMs: number): string {
  if (lastHeard === null) return '—';
  const seconds = Math.max(0, Math.round(nowMs / 1000) - lastHeard);
  if (seconds < 90) return 'NOW';
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}M`;
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))}H`;
  return `${String(Math.round(seconds / 86_400))}D`;
}

/**
 * `83% 4.01V`, `4.28V`, or null.
 *
 * A mains or solar node reports volts and no percent, so showing an empty
 * battery meter for it would be reporting a flat battery that is not flat.
 * Whichever numbers exist are shown, and when neither does the row omits the
 * field rather than drawing a zero.
 */
export function powerLine(node: MeshNode): string | null {
  const parts: string[] = [];
  // Meshtastic reports 101 for "plugged in, no battery", which is not a charge
  // level and must not be drawn as one.
  if (node.batteryPercent !== null && node.batteryPercent <= 100) {
    parts.push(`${String(Math.round(node.batteryPercent))}%`);
  }
  if (node.voltage !== null && Number.isFinite(node.voltage)) {
    parts.push(`${node.voltage.toFixed(2)}V`);
  }
  return parts.length === 0 ? null : parts.join(' ');
}

/** `DIRECT`, `2 HOPS`, or null when the node has not said. */
export function hopsLine(node: MeshNode): string | null {
  if (node.hopsAway === null) return null;
  return node.hopsAway === 0 ? 'DIRECT' : `${String(node.hopsAway)} HOPS`;
}
