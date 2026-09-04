/**
 * THE POSTED LIMIT, AND WHETHER YOU ARE OVER IT.
 *
 * =============================================================================
 * THE ONE RULE THAT MATTERS: NEVER GUESS
 * =============================================================================
 * The design says it in four words -- "unknown limit shows a dash, never a
 * guess" -- and it is the whole reason this file is not three lines.
 *
 * A speed limit read off a road sign is a fact. A speed limit INFERRED from a
 * road class, a country default, or the last road you were on is a plausible
 * number that will sometimes be wrong, and it will be wrong on exactly the
 * roads where it matters: the 25 through a school zone that the classifier
 * thinks is a residential 35. Drawing that inference on a white MUTCD plate --
 * the most authoritative-looking object on the screen -- makes the app assert
 * something it does not know, in the visual language of a road sign.
 *
 * So there is no default, no fallback and no nearest-guess. If OSM does not
 * carry `maxspeed` for the way the driver is on, the plate shows a dash and
 * the driver reads the actual sign, which is what they would have done anyway.
 *
 * =============================================================================
 * WHY OVER-THE-LIMIT IS NOT AN ALERT COLOUR
 * =============================================================================
 * `--fwm-speed-over` is deliberately not `--fwm-alert-in-range`. A camera in
 * range is the product's warning and has to stay the loudest red on the screen.
 * Driving four miles an hour over is a fact about the dashboard, not an alarm,
 * and giving the two the same colour trains a driver to discount the one that
 * matters.
 */

/** OSM writes `maxspeed` as "55 mph", "55", "50 km/h", "signals", "none"... */
const MPH_PATTERN = /^\s*(\d{1,3})\s*mph\s*$/i;
const KPH_PATTERN = /^\s*(\d{1,3})\s*(?:km\/h|kph|kmh)\s*$/i;

const KM_PER_MILE = 1.609344;

/**
 * How far over before the number changes colour.
 *
 * Not zero. GPS speed wanders by a mile an hour or two at a steady cruise, and
 * a readout that flickers between two colours while the driver holds one speed
 * is noise that teaches them to stop looking at it. Two is outside the noise
 * and inside anything anybody would call speeding.
 */
export const OVER_LIMIT_TOLERANCE_MPH = 2;

/**
 * Parse an OSM `maxspeed` value into mph, or null.
 *
 * NULL FOR EVERYTHING IT CANNOT READ, including the values that look like
 * information but are not a number: `signals`, `variable`, `none`, `walk`,
 * implicit country defaults like `RU:urban`. Each of those means "the limit is
 * not simply a number here", and the honest rendering of that is a dash.
 */
export function parseMaxspeed(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;

  const mph = MPH_PATTERN.exec(value);
  if (mph !== null) {
    const parsed = Number(mph[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  // An EXPLICIT metric value is not ambiguous and converts cleanly. Rare in
  // the US extract, but a border crossing is not a reason to print a dash.
  const kph = KPH_PATTERN.exec(value);
  if (kph !== null) {
    const parsed = Number(kph[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed / KM_PER_MILE);
  }

  // A BARE NUMBER IS A COIN FLIP, SO IT GETS A DASH.
  //
  // OSM's convention is unambiguous -- a unitless `maxspeed` is km/h -- and
  // reading it as mph would put a 50 km/h street on the plate as 50 mph.
  //
  // But this app only ever reads US data, and a survey of the US extract finds
  // ~9,100 ways carrying bare values (`25`, `40`, `50`) that are almost
  // certainly mistagged mph: 25 km/h is not a speed limit anybody posts, and
  // 25 mph is the commonest limit in the country. So the convention says one
  // number and the evidence says another, roughly twice apart.
  //
  // Following the convention prints 16 for a road signed 25. Following the
  // evidence prints a number on the strength of a hunch about a mapper's
  // intent. Both are guesses on an object drawn as a road sign, which is the
  // one thing this file exists to refuse -- so neither gets printed. 0.3% of
  // US values, and a dash is a correct answer for all of them.
  return null;
}

export interface SpeedPlateState {
  /** The posted limit in mph, or null when it is not known. */
  readonly limitMph: number | null;
  /** What the plate prints: the number, or a dash. Never a guess. */
  readonly limitLabel: string;
  /** The driver's speed in mph, or null. */
  readonly speedMph: number | null;
  readonly speedLabel: string;
  /** True only when BOTH numbers are known and the gap clears the tolerance. */
  readonly over: boolean;
}

export function speedPlateState(
  speedMph: number | null,
  maxspeed: string | null | undefined,
  tolerance: number = OVER_LIMIT_TOLERANCE_MPH,
): SpeedPlateState {
  const limitMph = parseMaxspeed(maxspeed);
  const speed =
    typeof speedMph === 'number' && Number.isFinite(speedMph) && speedMph >= 0
      ? Math.round(speedMph)
      : null;

  return {
    limitMph,
    // An em dash, not "??" or "N/A": it reads as "nothing to say here" rather
    // than as an error the driver should try to fix.
    limitLabel: limitMph === null ? '—' : String(limitMph),
    speedMph: speed,
    speedLabel: speed === null ? '—' : String(speed),
    // Both, or neither. Colouring a speed against a limit we do not have is the
    // same guess this file exists to refuse, wearing a different hat.
    over: limitMph !== null && speed !== null && speed > limitMph + tolerance,
  };
}
