/**
 * The dock: four glyph keys in a floating glass pill, and REPORT lifted out
 * beside it as its own circle.
 *
 * `src/app/App.tsx` renders one dock inside one fixed, safe-area padded chrome
 * block. `DockV1` is usable with no props (it reads the screen-state adapter)
 * and accepts explicit props for tests and for surfaces that drive it directly;
 * `report` is forwarded to `ReportKey`, which is also exported for tests that
 * drive the gestures alone.
 *
 * v0's `Dock` -- one 58px bar, five destination keys and REPORT folded in as a
 * sixth -- is DELETED, along with `DockKey`, `dock.css` and the hue table that
 * lit each destination in its own colour. It was reachable only as a default
 * prop and through the V0 row in SETTINGS; the v1 dock now serves both designs.
 * `ReportKey` and `DockIcon` survive it because v1 reuses one and MESH draws
 * the other; their rules moved to `reportKey.css` and `icons.css` with them.
 */

export {
  DOCK_V1_KEYS,
  DockV1,
  isKeyActive,
  type DockV1KeyDefinition,
  type DockV1Props,
} from './DockV1.tsx';
export { DockIcon, type DockIconProps } from './icons.tsx';
export {
  HOLD_MOVE_SLOP_PX,
  HOLD_TO_DROP_MS,
  PIN_CONFIRM_DWELL_MS,
  PIN_DROPPED_LABEL,
  REPORT_LABEL,
  ReportKey,
  type ReportKeyProps,
} from './ReportKey.tsx';
