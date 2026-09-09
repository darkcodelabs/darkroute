/**
 * The two counters: `CACHED CAMS` and `MAP TILES`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED`, lines
 * 108-118 -- a two-column grid, 8px gutter, each cell a bordered `#0E0F13`
 * card with a 9px `.18em` caption over a 28px mono value.
 *
 * Both numbers are counted off disk by `cache.ts`. Neither is ever estimated,
 * and neither renders `0` for "not read yet" -- see `format.ts`.
 */

import type { ReactElement } from 'react';

import { formatCacheCount } from '../format.ts';

export interface CacheCountersProps {
  /** Cameras across every cached tile, or null while the read is in flight. */
  readonly cachedCameras: number | null;
  /** Cached tiles, or null while the read is in flight. */
  readonly cachedTiles: number | null;
}

interface CounterProps {
  readonly label: string;
  readonly value: number | null;
}

function Counter({ label, value }: CounterProps): ReactElement {
  return (
    <div className="fwm-offline-counter" data-fwm-offline-counter={label}>
      <div className="fwm-offline-counter-label">{label}</div>
      <div className="fwm-offline-counter-value fwm-data">{formatCacheCount(value)}</div>
    </div>
  );
}

export function CacheCounters({ cachedCameras, cachedTiles }: CacheCountersProps): ReactElement {
  return (
    <div className="fwm-offline-counters">
      <Counter label="CACHED CAMS" value={cachedCameras} />
      <Counter label="MAP TILES" value={cachedTiles} />
    </div>
  );
}
