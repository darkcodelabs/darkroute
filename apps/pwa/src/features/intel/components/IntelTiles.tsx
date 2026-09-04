/**
 * `OWNER` · `MOUNT` · `FACING` -- three equal tiles.
 *
 * SOURCE: `A4 · INTEL CARD`. Three `flex:1` cards, 1px `--fwm-line` edge,
 * `--fwm-surface-1` fill, radius 2, 12px padding; a 9px/.16em mono label over
 * a 15px/600 value.
 *
 * A tile with nothing behind it renders an em dash and is marked
 * `data-fwm-intel-known="false"`. It is never dropped: three tiles that
 * sometimes become two is a layout that tells the driver less every time the
 * record is thinner, without ever saying so.
 */

import type { ReactElement } from 'react';

import type { IntelTile } from '../intelState.ts';

export interface IntelTilesProps {
  readonly tiles: readonly IntelTile[];
}

export function IntelTiles({ tiles }: IntelTilesProps): ReactElement {
  return (
    <div className="fwm-intel-tiles">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="fwm-intel-tile"
          data-fwm-intel-tile={tile.label}
          data-fwm-intel-known={tile.known ? 'true' : 'false'}
        >
          <span className="fwm-intel-tile-label fwm-data">{tile.label}</span>
          <span className="fwm-intel-tile-value">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}
