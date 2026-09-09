/**
 * The section-C screen primitives.
 *
 * Two glyphs and nothing else. The row, the card, the group header, the chip
 * and the segmented control are CSS classes in `styles/screen.css` rather than
 * components, deliberately: the five tab screens share a look and not a shape.
 * MORE's row is title-meta-chevron, LOOK UP's is dot-over-two-lines-distance,
 * EXPOSURE's is dot-place-clock. A component general enough to draw all three
 * would take six optional props and be harder to read than the JSX it replaced,
 * while the stylesheet already guarantees the only thing that has to be shared
 * -- 44 tall, radius 12, one hairline, one fill.
 */

export { ScreenChevron, ScreenPlane } from './icons.tsx';
