/**
 * THE MINI CARD - the app's own face, on the lock screen and on the wrist.
 *
 * WHY THIS FILE EXISTS
 *   A web notification is title, body, a 24dp stencil and a large icon. That is
 *   the whole vocabulary, and it is why the shade card looked like a system
 *   dialog while the in-app takeover looked like DarkRoute. There is exactly
 *   one slot with room for a design in it: `image`, which Chrome-on-Android
 *   renders as the expanded big picture and which a bridged Wear OS card uses
 *   as its background. So the card is DRAWN - here, to a canvas - and handed
 *   over as that image.
 *
 * WHY ON THE PAGE AND NOT IN THE WORKER
 *   There is no push server. Every notification in this product originates
 *   client-side from a store subscription, so the page is alive whenever a card
 *   is composed. Rendering here buys the document's fonts and `getComputedStyle`
 *   for free; rendering in the worker would mean re-declaring the typeface and
 *   inlining every colour as a literal, which is the second copy of the design
 *   system that `check-design-values.mjs` exists to prevent.
 *
 * WHY IT READS TOKENS INSTEAD OF HOLDING COLOURS
 *   Same problem `palette.ts` already solved for MapLibre: a renderer that
 *   cannot read CSS, handed literals resolved off the document. DarkRoute ships
 *   nineteen skins and six of them redeclare the alert hues. A card with
 *   `#FF2D5E` baked in would be correct in one skin and wrong in eighteen.
 *
 * WHAT IT REFUSES TO DRAW
 *   Camera cards carry a bearing and never a street or a coordinate, matching
 *   the payload contract in `adapters/notifications.ts`. The navigation card
 *   does name a street, because the driver typed the destination and an
 *   instruction that will not say the road is not an instruction. That
 *   asymmetry is the whole privacy position and it lives in the payloads, not
 *   here - this file draws what it is given.
 */

import { readTokens } from '../map/palette';
import {
  type AbuseAreaPayload,
  type CameraAlertPayload,
  type NavigationPayload,
  type NotificationPayload,
  type WatchlistPayload,
} from '../../services/adapters/notifications';

/**
 * 2:1. Chrome's big picture and Wear's card background both crop toward this
 * ratio; a squarer card loses its own edges on one of the two.
 */
export const CARD_W = 1024;
export const CARD_H = 512;

/** Tokens the card needs. Listed so they are greppable from tokens.css. */
export const CARD_TOKENS = [
  '--fwm-bg',
  '--fwm-surface-1',
  '--fwm-text',
  '--fwm-text-2',
  '--fwm-text-muted',
  '--fwm-line-strong',
  '--fwm-alert-approaching',
  '--fwm-alert-in-range',
  '--fwm-alert-multiple',
  '--fwm-alert-clear',
  '--fwm-accent-scan',
] as const;

export type CardToken = (typeof CARD_TOKENS)[number];
export type CardPalette = Readonly<Record<CardToken, string>>;

/**
 * The type ramp, scaled from the in-app card.
 *
 * `alertV1.css` is 80 / 17 / 14 / 13 / 11 against a 390pt phone. This canvas is
 * 1024 wide, so everything is multiplied by the same factor and rounded. One
 * enormous number and everything else small is the whole composition; keeping
 * the ratio is what makes the shade card read as the same object as the
 * takeover rather than a summary of it.
 */
const FIGURE_PX = 132;
const UNIT_PX = 40;
const SIDE_PX = 30;
const EYEBROW_PX = 22;
const PILL_PX = 22;
const FACT_PX = 26;
const HEADLINE_PX = 46;

const PAD = 56;
const RAIL_W = 10;

/**
 * The variable face tops out at 700 on its `wght` axis. Several CSS rules ask
 * for 800 and get clamped or synthesised; asking for 800 on a canvas would get
 * a fake bold that does not match the app.
 */
const BOLD = 700;
const MEDIUM = 600;
const REGULAR = 400;

function font(weight: number, px: number): string {
  return `${String(weight)} ${String(px)}px "Google Sans", system-ui, sans-serif`;
}

interface Surface {
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  encode: () => Promise<Blob | null>;
}

/**
 * OffscreenCanvas where it exists, a detached DOM canvas where it does not.
 * The same two-path shape `features/report/preparePhoto.ts` already uses; the
 * fallback matters because `convertToBlob` is the newer of the two APIs and a
 * card is not worth losing on an older WebView.
 */
function createSurface(): Surface | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(CARD_W, CARD_H);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    return {
      ctx,
      encode: async () => canvas.convertToBlob({ type: 'image/png' }),
    };
  }
  const doc = globalThis.document;
  if (doc === undefined) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  return {
    ctx,
    encode: async () =>
      new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      }),
  };
}

/** Letter-spaced small caps, drawn a glyph at a time. Canvas has no tracking. */
function tracked(
  ctx: Surface['ctx'],
  text: string,
  x: number,
  y: number,
  spacing: number,
): number {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
  return cursor - x - spacing;
}

function trackedWidth(ctx: Surface['ctx'], text: string, spacing: number): number {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  return total - spacing;
}

function roundRect(
  ctx: Surface['ctx'],
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: Surface['ctx'], text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

interface CardCopy {
  /** The hue this card is drawn in. */
  readonly hue: string;
  /** The pill at top right. */
  readonly pill: string;
  /** The enormous number, already formatted. Empty draws the headline instead. */
  readonly figure: string;
  /** The word beside the figure. "FT". */
  readonly unit: string;
  /** Used when there is no figure - a sentence at headline size. */
  readonly headline: string;
  /** The line under the figure. */
  readonly side: string;
  /** The quiet line at the foot. */
  readonly fact: string;
  /** Drawn to the right of the figure when present. */
  readonly turn?: string;
}

const STATE_TOKEN: Readonly<Record<string, CardToken>> = {
  clear: '--fwm-alert-clear',
  approaching: '--fwm-alert-approaching',
  in_range: '--fwm-alert-in-range',
  multiple: '--fwm-alert-multiple',
};

function cameraCopy(payload: CameraAlertPayload, palette: CardPalette): CardCopy {
  const token = STATE_TOKEN[payload.state] ?? '--fwm-alert-in-range';
  const count = payload.inRangeCount;
  return {
    hue: palette[token],
    pill: payload.state === 'multiple' ? 'MULTIPLE' : 'LIVE ALERT',
    figure: String(Math.round(payload.distanceFt)),
    unit: 'FT',
    headline: '',
    side: payload.bearingLabel.trim().toLowerCase(),
    fact: count > 1 ? `${String(count)} readers inside your threshold` : 'automated licence reader',
  };
}

function abuseCopy(payload: AbuseAreaPayload, palette: CardPalette): CardCopy {
  const entered = payload.trigger === 'entered';
  const record = `${String(payload.incidentCount)} documented misuse · ${String(payload.cameraCount)} cameras`;
  return {
    hue: palette['--fwm-alert-approaching'],
    pill: entered ? 'ABUSE AREA' : 'ABUSE NEARBY',
    figure: entered ? '' : String(Math.round(payload.distanceFt ?? 0)),
    unit: 'FT',
    headline: entered ? `entering ${payload.county}` : payload.county,
    /*
     * The NEARBY card names the county HERE, not in the headline.
     *
     * `headline` is only drawn when there is no figure, and a nearby card has
     * one: the distance. So a county in the headline slot is computed, handed
     * over and silently dropped, leaving "420 FT / documented incident nearby"
     * with no jurisdiction on it -- while the notification line directly above
     * the picture leads with `Jackson Co · 420 ft`. The card was contradicting
     * its own title.
     */
    side: entered ? payload.county.toLowerCase() : `documented incident in ${payload.county}`,
    fact: payload.worstCase === undefined ? record : `${record} · ${payload.worstCase}`,
  };
}

function navigationCopy(payload: NavigationPayload, palette: CardPalette): CardCopy {
  const ft = Math.round(payload.distanceFt);
  const parts: string[] = [];
  if (payload.etaMinutes !== undefined) parts.push(`${String(Math.round(payload.etaMinutes))} min`);
  if (payload.milesRemaining !== undefined) parts.push(`${payload.milesRemaining.toFixed(1)} mi`);
  if (payload.avoided !== undefined && payload.avoided > 0) {
    parts.push(`${String(payload.avoided)} cameras avoided`);
  }
  const now = payload.arriving === true || ft < 100;
  return {
    hue: palette['--fwm-accent-scan'],
    pill: payload.arriving === true ? 'ARRIVING' : 'NEXT TURN',
    figure: now ? '' : String(ft),
    unit: 'FT',
    headline: now ? (payload.arriving === true ? 'arriving' : 'now') : '',
    side: payload.instruction.toLowerCase(),
    fact: parts.join(' · '),
    turn: payload.turn,
  };
}

function watchlistCopy(payload: WatchlistPayload, palette: CardPalette): CardCopy {
  const n = payload.newReadCount;
  return {
    hue: palette['--fwm-accent-scan'],
    pill: 'WATCHLIST',
    figure: String(n),
    unit: n === 1 ? 'READ' : 'READS',
    headline: '',
    side: 'on a plate you are watching',
    fact: 'open darkroute to see which one',
  };
}

export function cardCopyFor(payload: NotificationPayload, palette: CardPalette): CardCopy {
  if (payload.kind === 'camera-alert') return cameraCopy(payload, palette);
  if (payload.kind === 'abuse-area') return abuseCopy(payload, palette);
  if (payload.kind === 'navigation') return navigationCopy(payload, palette);
  return watchlistCopy(payload, palette);
}

/**
 * The turn arrows, as canvas paths on the same 24-unit grid and 1.6 stroke the
 * in-app glyphs use, scaled up. `NavigationCard.tsx` draws thirteen of these as
 * inline SVG for the same reason they are geometry here and not a raster: the
 * product ships nineteen themes and a painted arrow is one colour forever.
 */
const AHEAD: readonly (readonly number[])[] = [
  [12, 21, 12, 4],
  [12, 4, 6, 10],
  [12, 4, 18, 10],
];

/**
 * One turning arrow, drawn LEFT. Right is the same path mirrored at draw time
 * rather than a second hand-tuned copy, because two copies of one arrow drift
 * the first time either is nudged.
 */
const TURNING: readonly (readonly number[])[] = [
  [18, 21, 8, 21],
  [8, 21, 8, 9],
  [8, 9, 3, 14],
  [8, 9, 13, 14],
];

function pathFor(turn: string): readonly (readonly number[])[] {
  if (turn === 'straight' || turn === 'start' || turn === 'arrive' || turn === 'merge') return AHEAD;
  return TURNING;
}

function drawTurn(ctx: Surface['ctx'], turn: string, cx: number, cy: number, size: number): void {
  const path = pathFor(turn);
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  if (turn.includes('right')) ctx.scale(-1, 1);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of path) {
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
    ctx.moveTo(x1 - 12, y1 - 12);
    ctx.lineTo(x2 - 12, y2 - 12);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the card. Exported separately from the blob so a test can assert on the
 * copy and the geometry without a canvas encoder.
 */
export function drawCard(
  ctx: Surface['ctx'],
  payload: NotificationPayload,
  palette: CardPalette,
): CardCopy {
  const copy = cardCopyFor(payload, palette);
  const ink = palette['--fwm-text'];
  const ink2 = palette['--fwm-text-2'];
  const muted = palette['--fwm-text-muted'];

  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = palette['--fwm-bg'];
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // The hue rail. The in-app card carries its state hue as a full border; at
  // notification size a border reads as a box, and a rail reads as a state.
  ctx.fillStyle = copy.hue;
  ctx.fillRect(0, 0, RAIL_W, CARD_H);

  const left = PAD + RAIL_W;
  ctx.textBaseline = 'alphabetic';

  // BRAND ROW.
  ctx.fillStyle = muted;
  ctx.font = font(BOLD, EYEBROW_PX);
  tracked(ctx, 'DARKROUTE', left, PAD + EYEBROW_PX, EYEBROW_PX * 0.16);

  // THE PILL, right-aligned, outlined in the hue over a wash of it.
  ctx.font = font(BOLD, PILL_PX);
  const pillText = copy.pill;
  const pillTextW = trackedWidth(ctx, pillText, PILL_PX * 0.14);
  const dot = 10;
  const pillW = pillTextW + dot + 18 + 44;
  const pillH = 46;
  const pillX = CARD_W - PAD - pillW;
  const pillY = PAD - 8;
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = copy.hue;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = copy.hue;
  ctx.lineWidth = 1.5;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.stroke();
  ctx.fillStyle = copy.hue;
  ctx.beginPath();
  ctx.arc(pillX + 22 + dot / 2, pillY + pillH / 2, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  tracked(ctx, pillText, pillX + 22 + dot + 12, pillY + pillH / 2 + PILL_PX * 0.36, PILL_PX * 0.14);

  // THE HEADLINE BLOCK. One enormous figure, or a sentence where there is no
  // number worth printing ("now", "arriving", "entering Jackson Co").
  const baseline = 300;
  let cursor = left;
  if (copy.figure.length > 0) {
    ctx.fillStyle = copy.hue;
    ctx.font = font(BOLD, FIGURE_PX);
    ctx.fillText(copy.figure, left, baseline);
    cursor = left + ctx.measureText(copy.figure).width + 20;
    ctx.fillStyle = ink;
    ctx.font = font(BOLD, UNIT_PX);
    tracked(ctx, copy.unit, cursor, baseline, UNIT_PX * 0.12);
    cursor += trackedWidth(ctx, copy.unit, UNIT_PX * 0.12);
  } else {
    ctx.fillStyle = copy.hue;
    ctx.font = font(BOLD, HEADLINE_PX);
    const head = truncate(ctx, copy.headline, CARD_W - left - PAD - 140);
    ctx.fillText(head, left, baseline - 30);
    cursor = left + ctx.measureText(head).width + 20;
  }

  if (copy.turn !== undefined) {
    ctx.strokeStyle = copy.hue;
    drawTurn(ctx, copy.turn, CARD_W - PAD - 60, baseline - 60, 108);
  }

  // THE SIDE PHRASE, under the figure.
  ctx.fillStyle = ink2;
  ctx.font = font(MEDIUM, SIDE_PX);
  ctx.fillText(truncate(ctx, copy.side, CARD_W - left - PAD - 160), left, baseline + 54);

  // THE FOOT. A hairline, then the quiet line.
  ctx.strokeStyle = palette['--fwm-line-strong'];
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, CARD_H - PAD - 54);
  ctx.lineTo(CARD_W - PAD, CARD_H - PAD - 54);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = font(REGULAR, FACT_PX);
  ctx.fillText(truncate(ctx, copy.fact, CARD_W - left - PAD), left, CARD_H - PAD - 12);

  return copy;
}

/**
 * One live object URL per tag. A notification replaces itself by tag all drive
 * long, so without this the blob for every superseded card would be held for
 * the life of the document.
 */
const liveUrls = new Map<string, string>();

export function revokeCard(tag: string): void {
  const previous = liveUrls.get(tag);
  if (previous === undefined) return;
  try {
    URL.revokeObjectURL(previous);
  } catch {
    // Already revoked, or no URL implementation. Neither is recoverable and
    // neither matters.
  }
  liveUrls.delete(tag);
}

/**
 * Render `payload` and return an object URL for the PNG, or null.
 *
 * Null is a normal answer: no canvas, no document, an encoder that declined.
 * The caller posts the notification without a picture, which is exactly what
 * shipped before this file existed.
 */
export async function renderCardImage(
  payload: NotificationPayload,
  tag: string,
): Promise<string | null> {
  const surface = createSurface();
  if (surface === null) return null;
  const palette = readTokens<CardToken>(CARD_TOKENS);
  try {
    drawCard(surface.ctx, payload, palette);
    const blob = await surface.encode();
    if (blob === null) return null;
    revokeCard(tag);
    const url = URL.createObjectURL(blob);
    liveUrls.set(tag, url);
    return url;
  } catch {
    return null;
  }
}
