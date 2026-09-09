/**
 * THE MINI CARD, ASSERTED IN TWO LAYERS BECAUSE THERE IS NO CANVAS HERE.
 *
 * jsdom's `getContext()` returns null and logs "Not implemented", so nothing in
 * this file can look at a pixel. That is not a gap: the two things this module
 * can actually get wrong are both visible without one.
 *
 *   THE COPY is a pure function of a payload and a palette. Every branch that
 *   decides what a card SAYS - which hue, which pill, a figure or a headline,
 *   singular or plural - is asserted directly, with no renderer in the way.
 *
 *   THE DRAWING is asserted against a recording context: a hand-rolled object
 *   that answers `measureText` and writes every mark into a list. That is the
 *   `pixelSweep.test.ts` idiom, and it catches the failures that matter here -
 *   painting the ground over the card, losing the hue rail, and printing
 *   something a camera payload is not allowed to print.
 *
 * WHY THE PALETTE FIXTURE IS NOT COLOURS
 * The whole point of `readTokens` is that this renderer holds no colour of its
 * own. A test that expected `#FF2D5E` would pass just as happily against a
 * renderer with `#FF2D5E` baked into it, which is the exact bug the token read
 * exists to prevent. So the fixture is a set of sentinels named after their
 * tokens, and every colour assertion is made against the palette object that
 * was handed in - twice, with two different palettes, so a literal cannot
 * satisfy both.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALERT_STATES, type AlertState } from '../../services/adapters/types.ts';
import {
  type AbuseAreaPayload,
  type CameraAlertPayload,
  type NavigationPayload,
  type NotificationPayload,
  type WatchlistPayload,
} from '../../services/adapters/notifications.ts';
import { withGlobalsAsync } from '../../services/adapters/testing/globals.ts';
import {
  CARD_H,
  CARD_TOKENS,
  CARD_W,
  cardCopyFor,
  drawCard,
  renderCardImage,
  revokeCard,
  type CardPalette,
  type CardToken,
} from './cardImage.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A palette of sentinels, one per token, so every hue assertion names the token
 * it came from. Nothing here is a colour; a renderer that shipped its own would
 * fail every one of these on the value it produced instead.
 */
function skin(prefix: string): CardPalette {
  return Object.fromEntries(
    CARD_TOKENS.map((token) => [token, `${prefix}${token}`]),
  ) as CardPalette;
}

const PALETTE = skin('paint:');
/** The nineteenth theme. Same tokens, different values, same card logic. */
const OTHER_SKIN = skin('other:');

const STATE_HUE: Readonly<Record<AlertState, CardToken>> = {
  clear: '--fwm-alert-clear',
  approaching: '--fwm-alert-approaching',
  in_range: '--fwm-alert-in-range',
  multiple: '--fwm-alert-multiple',
};

const CAMERA: CameraAlertPayload = {
  kind: 'camera-alert',
  state: 'in_range',
  distanceFt: 320,
  bearingLabel: 'ahead · slight left',
  inRangeCount: 1,
};

const ABUSE: AbuseAreaPayload = {
  kind: 'abuse-area',
  trigger: 'entered',
  county: 'Jackson Co',
  incidentCount: 3,
  cameraCount: 12,
};

const NAVIGATION: NavigationPayload = {
  kind: 'navigation',
  instruction: 'Turn right onto West 119th Street',
  turn: 'right',
  distanceFt: 400,
};

const WATCHLIST: WatchlistPayload = { kind: 'watchlist', newReadCount: 1 };

function camera(over: Partial<CameraAlertPayload>): CameraAlertPayload {
  return { ...CAMERA, ...over };
}

function abuse(over: Partial<AbuseAreaPayload>): AbuseAreaPayload {
  return { ...ABUSE, ...over };
}

function navigation(over: Partial<NavigationPayload>): NavigationPayload {
  return { ...NAVIGATION, ...over };
}

/** One of every kind, for the sweeps that must hold whatever the payload is. */
const EVERY_KIND: readonly NotificationPayload[] = [
  camera({ state: 'clear' }),
  camera({ state: 'approaching' }),
  camera({ state: 'in_range', inRangeCount: 4 }),
  camera({ state: 'multiple', inRangeCount: 4 }),
  ABUSE,
  abuse({ trigger: 'nearby', distanceFt: 420, worstCase: 'a sheriff office lookup' }),
  NAVIGATION,
  navigation({ arriving: true }),
  navigation({ distanceFt: 60 }),
  WATCHLIST,
  { kind: 'watchlist', newReadCount: 6 },
];

// ---------------------------------------------------------------------------
// The recording context
// ---------------------------------------------------------------------------

/**
 * Every glyph is this wide. Only the RATIO to the card matters: `truncate` and
 * the tracked runs both ask the context how wide a string is, so a stub that
 * answered a constant would make one long line and one short line measure the
 * same and would never truncate.
 */
const GLYPH_PX = 9;

interface DrawOp {
  readonly op: string;
  /** Empty for everything that is not a text mark. */
  readonly text: string;
  readonly args: readonly number[];
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly font: string;
  readonly alpha: number;
}

interface PaintState {
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly font: string;
  readonly alpha: number;
  readonly lineWidth: number;
}

/**
 * A 2D context that draws nothing and remembers everything, including the fill
 * and stroke in force at the moment of each mark - which is the only way to ask
 * "was the figure painted in the hue" of an API whose colour is a property
 * rather than an argument.
 *
 * `save`/`restore` keep a real stack. The turn glyph sets a line width inside
 * one, and a fake that let that leak would quietly disagree with the browser.
 */
class RecordingContext {
  readonly ops: DrawOp[] = [];
  fillStyle = '';
  strokeStyle = '';
  font = '';
  globalAlpha = 1;
  lineWidth = 0;
  lineCap = '';
  lineJoin = '';
  textBaseline = '';
  private readonly stack: PaintState[] = [];

  private mark(op: string, text: string, args: readonly number[]): void {
    this.ops.push({
      op,
      text,
      args,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      font: this.font,
      alpha: this.globalAlpha,
    });
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.mark('clearRect', '', [x, y, w, h]);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.mark('fillRect', '', [x, y, w, h]);
  }

  fillText(text: string, x: number, y: number): void {
    this.mark('fillText', text, [x, y]);
  }

  measureText(text: string): { readonly width: number } {
    return { width: text.length * GLYPH_PX };
  }

  beginPath(): void {
    this.mark('beginPath', '', []);
  }

  closePath(): void {
    this.mark('closePath', '', []);
  }

  moveTo(x: number, y: number): void {
    this.mark('moveTo', '', [x, y]);
  }

  lineTo(x: number, y: number): void {
    this.mark('lineTo', '', [x, y]);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.mark('arcTo', '', [x1, y1, x2, y2, r]);
  }

  arc(x: number, y: number, r: number, from: number, to: number): void {
    this.mark('arc', '', [x, y, r, from, to]);
  }

  fill(): void {
    this.mark('fill', '', []);
  }

  stroke(): void {
    this.mark('stroke', '', []);
  }

  translate(x: number, y: number): void {
    this.mark('translate', '', [x, y]);
  }

  scale(x: number, y: number): void {
    this.mark('scale', '', [x, y]);
  }

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      font: this.font,
      alpha: this.globalAlpha,
      lineWidth: this.lineWidth,
    });
    this.mark('save', '', []);
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous !== undefined) {
      this.fillStyle = previous.fillStyle;
      this.strokeStyle = previous.strokeStyle;
      this.font = previous.font;
      this.globalAlpha = previous.alpha;
      this.lineWidth = previous.lineWidth;
    }
    this.mark('restore', '', []);
  }
}

function paint(payload: NotificationPayload, palette: CardPalette = PALETTE): RecordingContext {
  const ctx = new RecordingContext();
  drawCard(ctx as unknown as CanvasRenderingContext2D, payload, palette);
  return ctx;
}

function textMarks(ctx: RecordingContext): readonly DrawOp[] {
  return ctx.ops.filter((op) => op.op === 'fillText');
}

/**
 * The marks joined. Tracked runs are drawn a glyph at a time, so DARKROUTE and
 * the pill only exist as words once the marks are put back together.
 */
function spelled(ctx: RecordingContext): string {
  return textMarks(ctx)
    .map((op) => op.text)
    .join('');
}

/**
 * The marks kept apart, for the privacy sweep. Joining first would let two
 * neighbouring runs manufacture a word neither of them drew, and a privacy
 * assertion that can be satisfied by an accident is not one.
 */
function separated(ctx: RecordingContext): string {
  return textMarks(ctx)
    .map((op) => op.text)
    .join(' ');
}

/** The ops between the first `open` and the first `close` that follows it. */
function between(ctx: RecordingContext, open: string, close: string): readonly DrawOp[] {
  const start = ctx.ops.findIndex((op) => op.op === open);
  if (start < 0) return [];
  const end = ctx.ops.findIndex((op, i) => i > start && op.op === close);
  return ctx.ops.slice(start, end < 0 ? undefined : end);
}

/** Anything that would place a driver on a named road. */
const STREET_WORDS =
  /\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|hwy|highway|pkwy|parkway|onto|turn)\b/i;
/** A decimal degree, which is what a leaked coordinate looks like. */
const COORDINATE = /-?\d{1,3}\.\d{3,}/;

// ---------------------------------------------------------------------------
// Layer 1 - the copy
// ---------------------------------------------------------------------------

describe('the tokens the card is built from', () => {
  it('names only custom properties that tokens.css actually defines', () => {
    // A misspelt token resolves to nothing, `readTokens` substitutes one grey,
    // and the card ships monochrome. Nothing else in the build catches that:
    // these names are strings in TypeScript and never appear in a stylesheet.
    const found = ['src/styles/tokens.css', 'apps/pwa/src/styles/tokens.css']
      .map((rel) => resolve(process.cwd(), rel))
      .find((path) => existsSync(path));
    expect(found, 'tokens.css not found').toBeDefined();
    const css = readFileSync(found as string, 'utf8');
    expect(CARD_TOKENS.filter((token) => !css.includes(`${token}:`))).toEqual([]);
  });

  it('is a 2:1 card, which is the crop both the shade and the wrist take', () => {
    expect(CARD_W).toBe(CARD_H * 2);
  });
});

describe('cardCopyFor, whatever the payload', () => {
  it('takes every hue out of the palette it was handed', () => {
    // The assertion that makes the token read worth doing: a hue is a VALUE
    // FROM THE ARGUMENT, not a string this module knows.
    const values = new Set(Object.values(PALETTE));
    for (const payload of EVERY_KIND) {
      const copy = cardCopyFor(payload, PALETTE);
      expect(values.has(copy.hue), `${payload.kind} drew a hue from nowhere: ${copy.hue}`).toBe(
        true,
      );
    }
  });

  it('draws a different card for a different skin, with no literal in common', () => {
    for (const payload of EVERY_KIND) {
      const mine = cardCopyFor(payload, PALETTE).hue;
      const theirs = cardCopyFor(payload, OTHER_SKIN).hue;
      expect(theirs, payload.kind).not.toBe(mine);
      expect(Object.values(OTHER_SKIN), payload.kind).toContain(theirs);
    }
  });

  it('never resolves a hue to a written colour', () => {
    // If this ever fails, somebody has put a hex, an rgb() or an hsl() back in
    // the renderer, and eighteen of the nineteen themes are now wrong.
    for (const payload of EVERY_KIND) {
      expect(cardCopyFor(payload, PALETTE).hue, payload.kind).not.toMatch(/^#|^rgb|^hsl/i);
    }
  });

  it('gives every card a pill and a foot line, so no card is half-drawn', () => {
    for (const payload of EVERY_KIND) {
      const copy = cardCopyFor(payload, PALETTE);
      expect(copy.pill.length, payload.kind).toBeGreaterThan(0);
      expect(copy.side.length, payload.kind).toBeGreaterThan(0);
    }
  });

  it('always has a headline block to draw, a figure or a sentence', () => {
    for (const payload of EVERY_KIND) {
      const copy = cardCopyFor(payload, PALETTE);
      // `drawCard` reads the figure first and only falls through to the
      // headline when there is none. Neither is a blank card; both is a
      // dropped headline, which is the skipped case further down.
      const hasBlock = copy.figure.length > 0 || copy.headline.length > 0;
      expect(hasBlock, `${payload.kind} draws no headline block`).toBe(true);
    }
  });
});

describe('the camera card', () => {
  it('carries the hue of its own state', () => {
    for (const state of ALERT_STATES) {
      const copy = cardCopyFor(camera({ state }), PALETTE);
      expect(copy.hue, state).toBe(PALETTE[STATE_HUE[state]]);
    }
  });

  it('says MULTIPLE only in the multiple state, and LIVE ALERT everywhere else', () => {
    for (const state of ALERT_STATES) {
      const copy = cardCopyFor(camera({ state }), PALETTE);
      expect(copy.pill, state).toBe(state === 'multiple' ? 'MULTIPLE' : 'LIVE ALERT');
    }
  });

  it('prints the distance as whole feet, because a decimal is not a distance', () => {
    const copy = cardCopyFor(camera({ distanceFt: 320.6 }), PALETTE);
    expect(copy.figure).toBe('321');
    expect(copy.unit).toBe('FT');
    expect(copy.headline).toBe('');
  });

  it('counts the readers only when there is more than one to count', () => {
    // One in range next to a distance is the same fact twice - the composer in
    // adapters/notifications.ts drops it for the same reason.
    expect(cardCopyFor(camera({ inRangeCount: 1 }), PALETTE).fact).toBe('automated licence reader');
    expect(cardCopyFor(camera({ inRangeCount: 4 }), PALETTE).fact).toBe(
      '4 readers inside your threshold',
    );
  });

  it('lower-cases and trims the bearing rather than printing it as it arrived', () => {
    const copy = cardCopyFor(camera({ bearingLabel: '  Ahead · Slight Left  ' }), PALETTE);
    expect(copy.side).toBe('ahead · slight left');
  });
});

describe('the abuse-area card', () => {
  it('is a sentence when you are in it and a distance when it is over there', () => {
    // "you are in it" and "it is over there" are different cards, and the
    // payload contract forbids collapsing them into one conditional clause.
    const entered = cardCopyFor(abuse({ trigger: 'entered' }), PALETTE);
    expect(entered.pill).toBe('ABUSE AREA');
    expect(entered.figure).toBe('');
    expect(entered.headline).toBe('entering Jackson Co');
    expect(entered.side).toBe('jackson co');

    const nearby = cardCopyFor(abuse({ trigger: 'nearby', distanceFt: 420.4 }), PALETTE);
    expect(nearby.pill).toBe('ABUSE NEARBY');
    expect(nearby.figure).toBe('420');
    expect(nearby.unit).toBe('FT');
    expect(nearby.side).toBe('documented incident in Jackson Co');
  });

  it('prints zero feet rather than NaN when a nearby payload carries no distance', () => {
    // `distanceFt` is optional and only meaningful for `nearby`, so the one
    // that omits it must still produce a figure a canvas can draw.
    expect(cardCopyFor(abuse({ trigger: 'nearby' }), PALETTE).figure).toBe('0');
  });

  it('states the record, and appends the worst case only when there is one', () => {
    expect(cardCopyFor(ABUSE, PALETTE).fact).toBe('3 documented misuse · 12 cameras');
    expect(cardCopyFor(abuse({ worstCase: 'a sheriff office lookup' }), PALETTE).fact).toBe(
      '3 documented misuse · 12 cameras · a sheriff office lookup',
    );
  });

  it('uses one hue for both triggers, and it is not a camera hue', () => {
    for (const trigger of ['entered', 'nearby'] as const) {
      expect(cardCopyFor(abuse({ trigger }), PALETTE).hue, trigger).toBe(
        PALETTE['--fwm-alert-approaching'],
      );
    }
  });
});

describe('the navigation card', () => {
  it('prints the distance while the turn is still far off', () => {
    const copy = cardCopyFor(navigation({ distanceFt: 400.4 }), PALETTE);
    expect(copy.pill).toBe('NEXT TURN');
    expect(copy.figure).toBe('400');
    expect(copy.headline).toBe('');
    expect(copy.turn).toBe('right');
    expect(copy.hue).toBe(PALETTE['--fwm-accent-scan']);
  });

  it('says now instead of a number at the mouth of the turn', () => {
    // Under 100 ft the number stops helping and starts arriving late.
    const copy = cardCopyFor(navigation({ distanceFt: 60 }), PALETTE);
    expect(copy.figure).toBe('');
    expect(copy.headline).toBe('now');
    expect(copy.pill).toBe('NEXT TURN');
  });

  it('says arriving on the final manoeuvre however far off it is', () => {
    const copy = cardCopyFor(navigation({ arriving: true, distanceFt: 400 }), PALETTE);
    expect(copy.pill).toBe('ARRIVING');
    expect(copy.headline).toBe('arriving');
    expect(copy.figure).toBe('');
  });

  it("lower-cases the router's own sentence for the side line", () => {
    expect(cardCopyFor(NAVIGATION, PALETTE).side).toBe('turn right onto west 119th street');
  });

  it('assembles the foot line out of whatever the route knows', () => {
    expect(
      cardCopyFor(navigation({ etaMinutes: 12.4, milesRemaining: 3.28, avoided: 2 }), PALETTE).fact,
    ).toBe('12 min · 3.3 mi · 2 cameras avoided');
  });

  it('omits a part the route cannot supply, and never says zero avoided', () => {
    // Zero cameras avoided on a camera-avoiding router is not a fact worth a
    // line; it reads as a failure.
    expect(cardCopyFor(navigation({ avoided: 0 }), PALETTE).fact).toBe('');
    expect(cardCopyFor(navigation({ etaMinutes: 9 }), PALETTE).fact).toBe('9 min');
  });
});

describe('the watchlist card', () => {
  it('counts reads, singular and plural', () => {
    const one = cardCopyFor({ kind: 'watchlist', newReadCount: 1 }, PALETTE);
    expect(one.figure).toBe('1');
    expect(one.unit).toBe('READ');

    const many = cardCopyFor({ kind: 'watchlist', newReadCount: 6 }, PALETTE);
    expect(many.figure).toBe('6');
    expect(many.unit).toBe('READS');
  });

  it('names no plate anywhere in the copy', () => {
    // The payload has no field a plate could arrive through; this pins that the
    // renderer does not invent one either.
    const copy = cardCopyFor(WATCHLIST, PALETTE);
    expect(copy.pill).toBe('WATCHLIST');
    expect(copy.side).toBe('on a plate you are watching');
    expect(copy.fact).toBe('open darkroute to see which one');
    expect(copy.hue).toBe(PALETTE['--fwm-accent-scan']);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 - the drawing
// ---------------------------------------------------------------------------

describe('drawCard, on a recording context', () => {
  it('paints the ground before it paints anything else', () => {
    // A ground painted late covers the card. The clear comes first so a reused
    // surface does not show the previous alert through the new one.
    const ctx = paint(CAMERA);
    expect(ctx.ops.slice(0, 3).map((op) => op.op)).toEqual(['clearRect', 'fillRect', 'fillRect']);
    const ground = ctx.ops[1];
    expect(ground?.args).toEqual([0, 0, CARD_W, CARD_H]);
    expect(ground?.fillStyle).toBe(PALETTE['--fwm-bg']);
  });

  it('runs the hue rail down the left edge in the state hue', () => {
    for (const state of ALERT_STATES) {
      const ctx = paint(camera({ state }));
      const rail = ctx.ops.filter((op) => op.op === 'fillRect')[1];
      expect(rail?.fillStyle, state).toBe(PALETTE[STATE_HUE[state]]);
      expect(rail?.args[0], `${state} rail is not at x=0`).toBe(0);
      expect(rail?.args[1], state).toBe(0);
      expect(rail?.args[3], `${state} rail does not run the full height`).toBe(CARD_H);
      // A rail, not a border and not a panel: narrow enough to read as state.
      expect(rail?.args[2] ?? 0, state).toBeGreaterThan(0);
      expect(rail?.args[2] ?? CARD_W, state).toBeLessThan(CARD_W / 8);
    }
  });

  it('signs every card DARKROUTE, in the muted ink', () => {
    const ctx = paint(CAMERA);
    const brand = textMarks(ctx).slice(0, 'DARKROUTE'.length);
    // Tracked, so nine marks rather than one string.
    expect(brand.map((op) => op.text).join('')).toBe('DARKROUTE');
    expect(new Set(brand.map((op) => op.fillStyle))).toEqual(
      new Set([PALETTE['--fwm-text-muted']]),
    );
  });

  it('draws the pill that names the kind of card it is', () => {
    const expected: readonly (readonly [NotificationPayload, string])[] = [
      [CAMERA, 'LIVE ALERT'],
      [camera({ state: 'multiple' }), 'MULTIPLE'],
      [ABUSE, 'ABUSE AREA'],
      [abuse({ trigger: 'nearby', distanceFt: 420 }), 'ABUSE NEARBY'],
      [NAVIGATION, 'NEXT TURN'],
      [navigation({ arriving: true }), 'ARRIVING'],
      [WATCHLIST, 'WATCHLIST'],
    ];
    for (const [payload, pill] of expected) {
      expect(spelled(paint(payload)), payload.kind).toContain(pill);
    }
  });

  it('paints the figure in the state hue and the unit in the ink', () => {
    // The one composition rule the card has: one enormous number in the colour
    // of the warning, and everything else quiet beside it.
    const ctx = paint(camera({ distanceFt: 320 }));
    const marks = textMarks(ctx);
    const at = marks.findIndex((op) => op.text === '320');
    expect(at, 'the figure was never drawn').toBeGreaterThan(-1);
    expect(marks[at]?.fillStyle).toBe(PALETTE['--fwm-alert-in-range']);
    // The unit follows it, tracked, in the ink rather than the hue.
    expect(marks[at + 1]?.text).toBe('F');
    expect(marks[at + 2]?.text).toBe('T');
    expect(marks[at + 1]?.fillStyle).toBe(PALETTE['--fwm-text']);
    expect(marks[at + 2]?.fillStyle).toBe(PALETTE['--fwm-text']);
  });

  it('draws the headline in the hue when there is no figure, and no unit beside it', () => {
    const ctx = paint(abuse({ trigger: 'entered' }));
    const headline = textMarks(ctx).find((op) => op.text === 'entering Jackson Co');
    expect(headline?.fillStyle).toBe(PALETTE['--fwm-alert-approaching']);
    // FT is only ever drawn beside a figure; an orphaned unit is the bug.
    expect(spelled(ctx)).not.toContain('FT');
  });

  /*
   * REGRESSION. This failed when the test was written: `abuseCopy` built a
   * NEARBY card with both a figure (the distance) and a headline (the county),
   * and `drawCard` reads the headline only when there is no figure -- so the
   * county was computed, handed over and dropped. The card said "420 FT /
   * documented incident nearby" while the notification title directly above it
   * led with `Jackson Co · 420 ft`. The county now rides in `side`, which a
   * nearby card does draw.
   */
  it('names the county on a nearby abuse card, not only on the one you entered', () => {
    expect(spelled(paint(abuse({ trigger: 'nearby', distanceFt: 420 })))).toContain('Jackson Co');
  });

  it('draws the side phrase in the second ink and the foot line in the muted one', () => {
    const ctx = paint(CAMERA);
    expect(textMarks(ctx).find((op) => op.text === 'ahead · slight left')?.fillStyle).toBe(
      PALETTE['--fwm-text-2'],
    );
    expect(textMarks(ctx).find((op) => op.text === 'automated licence reader')?.fillStyle).toBe(
      PALETTE['--fwm-text-muted'],
    );
  });

  it('rules the foot hairline in the line token, not in the hue', () => {
    const ctx = paint(CAMERA);
    const strokes = ctx.ops.filter((op) => op.op === 'stroke');
    expect(strokes.at(-1)?.strokeStyle).toBe(PALETTE['--fwm-line-strong']);
  });

  it('truncates a line too long for the card instead of running it off the edge', () => {
    const long = `Turn right onto ${'Extremely Long Boulevard '.repeat(6)}North`;
    const ctx = paint(navigation({ instruction: long }));
    const cut = textMarks(ctx).find((op) => op.text.endsWith('…'));
    expect(cut, 'the long instruction was drawn whole').toBeDefined();
    expect(cut?.text.length ?? 0).toBeLessThan(long.length);
    expect(long.toLowerCase().startsWith((cut?.text ?? '').slice(0, -1).trimEnd())).toBe(true);
  });
});

describe('the turn glyph', () => {
  it('is drawn only for a card that has a turn on it', () => {
    // save/restore happen nowhere else in this renderer, so their absence is
    // the absence of the glyph.
    expect(paint(CAMERA).ops.some((op) => op.op === 'save')).toBe(false);
    expect(paint(NAVIGATION).ops.some((op) => op.op === 'save')).toBe(true);
  });

  it('strokes the arrow in the card hue', () => {
    const ctx = paint(NAVIGATION);
    const inside = between(ctx, 'save', 'restore');
    expect(inside.find((op) => op.op === 'stroke')?.strokeStyle).toBe(PALETTE['--fwm-accent-scan']);
  });

  it('mirrors the one hand-drawn arrow rather than keeping a second copy', () => {
    const right = between(paint(navigation({ turn: 'right' })), 'save', 'restore');
    const left = between(paint(navigation({ turn: 'left' })), 'save', 'restore');
    const mirrored = (ops: readonly DrawOp[]): boolean =>
      ops.some((op) => op.op === 'scale' && (op.args[0] ?? 0) < 0);
    expect(mirrored(right), 'a right turn drew the left arrow unmirrored').toBe(true);
    expect(mirrored(left), 'a left turn was mirrored').toBe(false);
    // Same path, so the same number of segments either way.
    const segments = (ops: readonly DrawOp[]): number =>
      ops.filter((op) => op.op === 'lineTo').length;
    expect(segments(right)).toBe(segments(left));
  });

  it('draws a straight-ahead arrow for the manoeuvres that are not turns', () => {
    const turning = between(paint(navigation({ turn: 'left' })), 'save', 'restore');
    for (const turn of ['straight', 'start', 'arrive', 'merge']) {
      const ahead = between(paint(navigation({ turn })), 'save', 'restore');
      const segments = ahead.filter((op) => op.op === 'lineTo').length;
      expect(segments, turn).toBeGreaterThan(0);
      expect(segments, `${turn} drew the turning arrow`).not.toBe(
        turning.filter((op) => op.op === 'lineTo').length,
      );
    }
  });
});

describe('what the card refuses to draw', () => {
  it('never puts a street or a coordinate on a camera card', () => {
    // THE PRIVACY POSITION, checked on the paint rather than on the payload.
    // A camera card is a bearing and a distance; nobody asked to have their
    // position narrated to a lock screen.
    for (const state of ALERT_STATES) {
      const drawn = separated(paint(camera({ state, inRangeCount: 4, distanceFt: 320.6 })));
      // Guard against a vacuous pass: the card really did draw its own words.
      expect(drawn, state).toContain('ahead · slight left');
      expect(STREET_WORDS.test(drawn), `${state} drew a street: ${drawn}`).toBe(false);
      expect(COORDINATE.test(drawn), `${state} drew a coordinate: ${drawn}`).toBe(false);
    }
  });

  it('puts no street on the abuse or watchlist cards either', () => {
    for (const payload of [ABUSE, abuse({ trigger: 'nearby', distanceFt: 420 }), WATCHLIST]) {
      const drawn = separated(paint(payload));
      expect(STREET_WORDS.test(drawn), `${payload.kind} drew a street: ${drawn}`).toBe(false);
    }
  });

  it('DOES name the street on the turn card, which is the whole asymmetry', () => {
    // The driver typed the destination. An instruction that will not say the
    // road is not an instruction - and a privacy test that passed because the
    // renderer draws nothing would pass here too, so this is the control.
    const drawn = spelled(paint(NAVIGATION));
    expect(drawn).toContain('turn right onto west 119th street');
    expect(STREET_WORDS.test(drawn)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 - the blob
// ---------------------------------------------------------------------------

/** What the stand-in encoder hands back. Reset before each test. */
let encoded: Blob | null = null;

/**
 * An OffscreenCanvas that records instead of rasterising. jsdom has neither
 * this nor a 2D context, so the encode path is unreachable without it - and
 * unreachable is exactly how the tag/URL bookkeeping went untested.
 */
class FakeOffscreenCanvas {
  static last: FakeOffscreenCanvas | null = null;
  readonly ctx = new RecordingContext();
  encodedAs = '';

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    FakeOffscreenCanvas.last = this;
  }

  getContext(kind: string): RecordingContext | null {
    return kind === '2d' ? this.ctx : null;
  }

  async convertToBlob(options: { readonly type?: string }): Promise<Blob | null> {
    this.encodedAs = options.type ?? '';
    return encoded;
  }
}

async function render(payload: NotificationPayload, tag: string): Promise<string | null> {
  return withGlobalsAsync({ OffscreenCanvas: FakeOffscreenCanvas }, async () =>
    renderCardImage(payload, tag),
  );
}

describe('renderCardImage', () => {
  beforeEach(() => {
    encoded = new Blob(['png']);
    FakeOffscreenCanvas.last = null;
  });

  it('answers null rather than throwing when there is nothing to draw on', async () => {
    // jsdom's getContext returns null and logs "Not implemented", which is the
    // same shape as an old WebView without a 2D context. The caller posts the
    // notification without a picture, which is what shipped before this file.
    const url = await withGlobalsAsync({ OffscreenCanvas: undefined }, async () =>
      renderCardImage(CAMERA, 'fwm-test-no-context'),
    );
    expect(url).toBeNull();
  });

  it('answers null in a context with no document at all', async () => {
    const url = await withGlobalsAsync(
      { OffscreenCanvas: undefined, document: undefined },
      async () => renderCardImage(CAMERA, 'fwm-test-no-document'),
    );
    expect(url).toBeNull();
  });

  it('draws the card at card size and encodes it as a png', async () => {
    const url = await render(CAMERA, 'fwm-test-render');
    expect(url).toMatch(/^blob:/);
    const surface = FakeOffscreenCanvas.last;
    expect(surface?.width).toBe(CARD_W);
    expect(surface?.height).toBe(CARD_H);
    // PNG rather than JPEG: the card has transparency at its corners on some
    // shades, and a JPEG would fill them.
    expect(surface?.encodedAs).toBe('image/png');
    expect(surface === null ? '' : spelled(surface.ctx)).toContain('DARKROUTE');
    revokeCard('fwm-test-render');
  });

  it('answers null when the encoder declines', async () => {
    encoded = null;
    expect(await render(CAMERA, 'fwm-test-declined')).toBeNull();
  });

  it('releases the previous card when a tag renders again', async () => {
    // A tag replaces itself the whole drive, so without this every superseded
    // card is held for the life of the document.
    const first = await render(camera({ distanceFt: 400 }), 'fwm-test-tag');
    expect(first).not.toBeNull();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const second = await render(camera({ distanceFt: 200 }), 'fwm-test-tag');
    expect(revoke).toHaveBeenCalledWith(first);
    expect(second).not.toBe(first);
    revokeCard('fwm-test-tag');
  });

  it('holds one url per tag, so one card never evicts another', async () => {
    const cameraUrl = await render(CAMERA, 'fwm-test-camera');
    const navUrl = await render(NAVIGATION, 'fwm-test-navigation');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    revokeCard('fwm-test-camera');
    expect(revoke).toHaveBeenCalledWith(cameraUrl);
    expect(revoke).not.toHaveBeenCalledWith(navUrl);
    revokeCard('fwm-test-navigation');
  });
});

describe('revokeCard', () => {
  it('is safe for a tag that was never rendered', () => {
    expect(() => {
      revokeCard('fwm-never-rendered');
    }).not.toThrow();
  });

  it('is safe twice for the same tag', async () => {
    encoded = new Blob(['png']);
    await render(CAMERA, 'fwm-test-twice');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    revokeCard('fwm-test-twice');
    revokeCard('fwm-test-twice');
    // The second call has nothing to release; releasing a stale url twice is
    // how a live card loses its picture.
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
