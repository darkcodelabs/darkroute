#!/usr/bin/env node
/**
 * check-design-values.mjs -- DarkRoute design-contract enforcement.
 *
 * Zero dependencies. node:fs + node:path only. Requires Node >= 20.11
 * (uses `import.meta.dirname` / `import.meta.filename`).
 *
 * Every color, size, spacing, radius, duration and easing curve in application
 * source must be `var(--fwm-*)`. `apps/pwa/src/styles/tokens.css` is the single
 * place raw design values are allowed to exist. This script walks the repo and
 * fails the build when anything else hardcodes one.
 *
 * The other half of that contract: a `var(--fwm-*)` must actually name
 * something. CSS treats an undefined custom property as no declaration at all
 * -- no warning, no fallback, no paint -- so a reference to a token that does
 * not exist reads as compliant here and renders as nothing on the phone.
 *
 * Usage:
 *   node scripts/check-design-values.mjs
 *   node scripts/check-design-values.mjs --json
 *   node scripts/check-design-values.mjs --fix-hint
 *   node scripts/check-design-values.mjs --root <dir> --allowlist <file>
 *
 * Exit codes: 0 = clean, 1 = violations or bad allowlist, 2 = usage error.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

/** Directories that are never scanned, at any depth. */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.turbo',
  '.vite', '.cache', 'out', '__snapshots__',
]);

/** Scan targets, relative to root. `packages/<name>/src` is discovered. */
const SCAN_TARGETS = [
  'apps/pwa/src',
  'apps/pwa/public',
  'apps/pwa/index.html',
];

/** Extensions whose *content* is scanned. */
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.html', '.htm', '.json', '.webmanifest',
]);

/** Extensions treated as image assets (content is never read). */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.avif', '.ico']);

/**
 * The only files allowed to contain raw design values. Nothing else in the
 * repo may hardcode a color, length, duration, easing curve or shadow.
 */
const TOKEN_SOURCES = new Set([
  'apps/pwa/src/styles/tokens.css',
  'apps/pwa/src/styles/tokens.json',
]);

/** Rules the token sources are exempt from -- they ARE the raw values. */
const TOKEN_SOURCE_EXEMPT_RULES = new Set([
  'hex-color', 'color-fn', 'named-color', 'length', 'duration', 'easing',
  'shadow', 'radius',
]);

/**
 * The brand master images, and the icon files generated from them.
 *
 * DarkRoute ships TWO, and they are not interchangeable:
 *
 *   darkroute-mark.png   THE MARK. White on transparent. Every alpha-mask
 *                           derivative is built from this - `purpose:
 *                           monochrome`, the notification badge, and Android's
 *                           themed icon - because those are masks the platform
 *                           tints, and a mask needs transparency to be a shape
 *                           rather than a filled square.
 *
 *   darkroute-icon.png        THE ARTWORK. Full colour, opaque, edge to edge.
 *                           What the launcher and the install prompt show:
 *                           `purpose: any`, `purpose: maskable`, and the
 *                           Android legacy and adaptive-foreground icons.
 *
 * Anything else raster or vector under apps/pwa/{public,src} must be derived
 * from one of them, which means it appears here -- or is exempted by an
 * allowlist entry with a written reason.
 */
const BRAND_MASTER = 'apps/pwa/public/assets/darkroute-mark.png';
const ART_MASTER = 'apps/pwa/public/assets/darkroute-icon.png';
const GENERATED_ASSETS = new Set([
  BRAND_MASTER,
  ART_MASTER,
  'apps/pwa/public/favicon.ico',
  'apps/pwa/public/favicon.png',
]);
/**
 * A SECOND BRAND MARK, supplied rather than generated.
 *
 * The rule above exists so an unaccounted image cannot appear in the product
 * without somebody noticing, and that intent is kept: this is listed, not
 * exempted by pattern. It is the NODE mark, a hexagon of mesh nodes around an
 * eye, and it is not derived from the eye master because it is a different
 * drawing rather than a crop of one.
 *
 * The dock does NOT use this file. Dock icons paint in `currentColor` so they
 * can carry the key's state, which a raster cannot do, and at 24px the
 * interior lattice collapses into texture. `components/dock/icons.tsx` draws a
 * reduced version in SVG. This is the full artwork, for surfaces with room.
 */
const SUPPLIED_ASSETS = new Set([
  'apps/pwa/public/assets/node-mesh-eye.png',
  /*
   * THE WIDE LOGO, at full halftone, for the one surface with room for it.
   *
   * Not derived from either master and it cannot be: `darkroute-mark.png` is
   * the SOLID reduction drawn for 16-24px masks, and deriving the halftone back
   * out of it is not a thing that can happen. It is the original render.
   *
   * It is here rather than in the icon pipeline because it only works large.
   * The DRIVE status pill gives it a 32px band, which is where the dither still
   * reads as tone; every smaller surface uses the mark instead.
   */
  'apps/pwa/public/assets/darkroute-wide.png',
  /*
   * THE LOGOTYPE STENCIL, which is what DRIVE's heading now draws.
   *
   * `darkroute.ai` set as the brand's distressed lettering. Not derived from
   * either master and it cannot be: both masters are the EYE, and this is
   * type. It is the supplied render, trimmed to its own alpha bounding box and
   * resampled to 1200px wide.
   *
   * A STENCIL, NOT A PICTURE, and that is why there is one file and not two.
   * Its RGB channels are flattened to white and carry no information; every
   * pixel of the artwork is in the ALPHA - 77.9% transparent, 21.8% partial,
   * which is the distress itself. `.fwm-reloadtitle-mark` masks it and paints
   * the result in `--fwm-text`, so the same file is white on the dark palettes
   * and near-black on `refinement`. An inverted second copy was the obvious
   * alternative and would have been two files to re-export on every brand
   * change, plus a light theme that keeps the dark artwork the first time
   * somebody forgets one.
   */
  'apps/pwa/public/assets/darkroute-wordmark.png',
]);

/** Sized PWA icons generated from BRAND_MASTER. */
const GENERATED_ICON_RE =
  /^apps\/pwa\/public\/icons\/(icon|maskable|monochrome|apple-touch-icon)-\d{2,4}\.png$/;

/**
 * The only font families this product ships.
 *
 * `google sans` is the theme face and belongs here rather than in the
 * allowlist. It was briefly removed on the argument that it is Google's closed
 * brand font and could not be redistributed. That stopped being true: the
 * family is published under the OFL, and `apps/pwa/public/fonts/LICENSES.md`
 * records the bytes, the SHA-256 and the exact distribution source the same way
 * it does for the other seven.
 *
 * What this rule still exists to catch is the OTHER half, which never changed:
 * a face named here must be SELF-HOSTED. The scan below rejects any
 * `fonts.googleapis.com` reference whatever the family, because linking it at
 * runtime hands Google the IP of every driver on every cold start and leaves the
 * face missing offline.
 */
const ALLOWED_FONTS = new Set([
  'google sans', 'chakra petch', 'jetbrains mono',
  'system-ui', 'sans-serif', 'ui-monospace', 'monospace',
  'inherit', 'initial', 'unset', 'revert', '',
]);

/** CSS named colors. `color: red` is a hardcoded design value too. */
const NAMED_COLORS = new Set((
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
  'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
  'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
  'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
  'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
  'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
  'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
  'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
  'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
  'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
  'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
).split(' '));

const ALL_RULE_IDS = [
  'tailwind-arbitrary', 'font-family', 'shadow', 'radius', 'easing',
  'hex-color', 'color-fn', 'named-color', 'duration', 'length', 'hover', 'asset',
  'unresolved-var',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `check-design-values -- enforce var(--fwm-*) everywhere but tokens.css

  --json        machine-readable output on stdout
  --fix-hint    print the closest var(--fwm-*) token for each violation
  --root DIR    repo root to scan (default: the repo this script lives in)
  --allowlist F path to design-values-allowlist.json
  -h, --help    this text
`;

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, allowlist: null, json: false, fixHint: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--fix-hint') opts.fixHint = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--root') opts.root = resolve(argv[++i] ?? '');
    else if (a === '--allowlist') opts.allowlist = resolve(argv[++i] ?? '');
    else {
      process.stderr.write(`check-design-values: unknown argument ${a}\n`);
      process.exit(2);
    }
  }
  if (!opts.allowlist) opts.allowlist = join(opts.root, 'scripts', 'design-values-allowlist.json');
  return opts;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

class AllowlistError extends Error {}

/**
 * Load + validate the allowlist. Every entry MUST carry a `reason`: an
 * exemption nobody can explain is an exemption nobody can review.
 */
function loadAllowlist(file) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new AllowlistError(`allowlist is not valid JSON (${file}): ${err.message}`);
  }
  if (!Array.isArray(raw)) {
    throw new AllowlistError(`allowlist must be a JSON array of objects (${file})`);
  }
  return raw.map((entry, i) => {
    const at = `${file}[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AllowlistError(`allowlist entry must be an object at ${at}`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new AllowlistError(
        `allowlist entry missing reason at ${at} (path: ${entry.path ?? '<none>'})`,
      );
    }
    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      throw new AllowlistError(`allowlist entry missing path at ${at}`);
    }
    if (typeof entry.rule !== 'string' || entry.rule.trim() === '') {
      throw new AllowlistError(`allowlist entry missing rule at ${at} (path: ${entry.path})`);
    }
    if (entry.rule !== '*' && !ALL_RULE_IDS.includes(entry.rule)) {
      throw new AllowlistError(
        `allowlist entry references unknown rule "${entry.rule}" at ${at} ` +
        `(known: ${ALL_RULE_IDS.join(', ')})`,
      );
    }
    let re = null;
    if (entry.pattern !== undefined) {
      if (typeof entry.pattern !== 'string') {
        throw new AllowlistError(`allowlist pattern must be a string at ${at}`);
      }
      try {
        re = new RegExp(entry.pattern);
      } catch (err) {
        throw new AllowlistError(`allowlist pattern is not a valid regex at ${at}: ${err.message}`);
      }
    }
    return {
      path: entry.path,
      rule: entry.rule,
      pattern: re,
      reason: entry.reason,
      matcher: pathMatcher(entry.path),
    };
  });
}

/** Simple, linear glob -> predicate. Supports `*` (segment) and `**` (any). */
function pathMatcher(glob) {
  if (!glob.includes('*') && !glob.includes('?')) {
    return (rel) => rel === glob || rel.startsWith(`${glob}/`);
  }
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; src += '(?:.*/)?'; } else { src += '.*'; }
      } else {
        src += '[^/]*';
      }
    } else if (c === '?') {
      src += '[^/]';
    } else {
      src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${src}$`);
  return (rel) => re.test(rel);
}

function isAllowed(allowlist, violation) {
  for (const entry of allowlist) {
    if (entry.rule !== '*' && entry.rule !== violation.rule) continue;
    if (!entry.matcher(violation.file)) continue;
    if (entry.pattern && !entry.pattern.test(violation.text)) continue;
    return entry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

function* walk(absDir, root) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of entries) {
    const abs = join(absDir, dirent.name);
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      yield* walk(abs, root);
    } else if (dirent.isFile()) {
      yield toRel(abs, root);
    }
  }
}

function toRel(abs, root) {
  return abs.slice(root.length + 1).split(sep).join('/');
}

function isTestFile(rel) {
  return /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

function extOf(rel) {
  const i = rel.lastIndexOf('.');
  return i === -1 ? '' : rel.slice(i).toLowerCase();
}

function collectFiles(root) {
  const targets = [...SCAN_TARGETS];
  const pkgDir = join(root, 'packages');
  if (existsSync(pkgDir)) {
    for (const dirent of readdirSync(pkgDir, { withFileTypes: true })) {
      if (dirent.isDirectory() && !SKIP_DIRS.has(dirent.name)) {
        targets.push(`packages/${dirent.name}/src`);
      }
    }
  }
  const out = [];
  const seen = new Set();
  for (const target of targets) {
    const abs = join(root, target);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      for (const rel of walk(abs, root)) {
        if (!seen.has(rel)) { seen.add(rel); out.push(rel); }
      }
    } else if (!seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Comment masking
// ---------------------------------------------------------------------------

const JS_EXT = /^\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Blank out comment bodies while preserving byte offsets and newlines, so that
 * documented values do not trip the checker. Strings are tracked but NOT
 * masked -- a hex color hidden in a string literal is exactly the kind of
 * violation this exists to find.
 */
function maskComments(src, ext) {
  const n = src.length;
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  if (ext === '.json' || ext === '.webmanifest') return src;

  if (ext === '.html' || ext === '.htm') {
    let i = 0;
    while (i < n) {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        const stop = end === -1 ? n : end + 3;
        blank(i, stop);
        i = stop;
      } else i++;
    }
    return out.join('');
  }

  // CSS has no `//` comment, but `url(http://...)` does. Only JS-family files
  // get line-comment handling.
  const lineComments = JS_EXT.test(ext);
  let i = 0;
  let mode = 'code';
  let quote = '';
  /**
   * The template literals whose `${...}` we are currently inside.
   *
   * WHY A STACK AND NOT A FLAG. Stepping into `${` used to set `mode = 'code'`
   * and drop the quote entirely, which forgets that a template is still open.
   * The `}` then closed nothing, and the template's CLOSING BACKTICK was read
   * as the start of a NEW string -- which ran to the end of the file. Every
   * comment after the first interpolated template in a file went unmasked, so
   * the checker read prose as code and reported values that were only ever
   * being discussed. Two `375px` and three hex colours in `intelState.ts`,
   * every one of them inside a comment naming the token it came from.
   *
   * Each entry counts the braces opened inside that expression, so a `}` only
   * returns to the template when it is the one that closes `${`.
   */
  const templates = [];
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        blank(i, stop);
        i = stop;
      } else if (lineComments && c === '/' && d === '/') {
        let end = src.indexOf('\n', i);
        if (end === -1) end = n;
        blank(i, end);
        i = end;
      } else if (c === '"' || c === "'" || c === '`') {
        mode = 'string';
        quote = c;
        i++;
      } else if (templates.length > 0 && c === '{') {
        templates[templates.length - 1].depth += 1;
        i++;
      } else if (templates.length > 0 && c === '}') {
        const top = templates[templates.length - 1];
        if (top.depth === 0) {
          // The `}` that closes `${`: back inside the template it belongs to.
          templates.pop();
          mode = 'string';
          quote = '`';
        } else top.depth -= 1;
        i++;
      } else i++;
    } else if (c === '\\') i += 2;
    else if (c === quote) { mode = 'code'; quote = ''; i++; }
    else if (quote === '`' && c === '$' && d === '{') {
      templates.push({ depth: 0 });
      mode = 'code';
      quote = '';
      i += 2;
    }
    else if (c === '\n' && quote !== '`') { mode = 'code'; quote = ''; i++; }
    else i++;
  }
  return out.join('');
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

function locate(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, col: index - starts[lo] + 1 };
}

function lineTextAt(src, starts, index) {
  const { line } = locate(starts, index);
  const from = starts[line - 1];
  const nl = src.indexOf('\n', from);
  return src.slice(from, nl === -1 ? src.length : nl);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RE = {
  /**
   * The trailing guard is `\w`, not just a hex digit.
   *
   * With only the hex-digit guard, a JavaScript PRIVATE FIELD whose name starts
   * with hex letters is a colour: `#dedupeCache` matched as `#ded` because the
   * `u` that follows is not a hex digit. No CSS colour is ever followed by a
   * word character, so widening the guard costs nothing and closes the whole
   * class -- `#faceted`, `#addAll`, `#decode` and every other `#[a-f]{3}\w+`
   * field name that would otherwise have to be renamed to appease a linter.
   */
  hex: /(?<![&\w])#([0-9a-fA-F]{3,8})(?!\w)/g,
  colorFn: /\b(rgba?|hsla?|color-mix|oklch)\s*\(/gi,
  length: /(?<![\w.#])(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|vmin|vmax|dvh|dvw|svh|svw|lvh|lvw|vh|vw)(?![\w-])/g,
  time: /(?<![\w.#])(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)(?![\w-])/g,
  cubic: /\bcubic-bezier\s*\(/g,
  easeWord: /(?<![\w-])(ease-in-out|ease-in|ease-out|ease-linear)(?![\w-])/g,
  easeBare: /(?<![\w-])(ease|linear|step-start|step-end|steps)(?![\w-])/g,
  arbitrary: /(?<![\w])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]\n]{1,200}\]/gi,
  hoverTw: /(?<![\w-])(?:group-|peer-)?hover:/g,
  hoverCss: /:hover(?![\w-])/g,
  fontDecl: /(?:font-family|fontFamily|--fwm-font-[a-z0-9-]+)\s*:\s*([^;}\n]+)/gi,
  googleFont: /[?&]family=([^&"'\s>]+)/g,
  shadowDecl: /\b(box-shadow|text-shadow|boxShadow|textShadow)\s*:\s*([^;}\n]+)/gi,
  dropShadow: /\bdrop-shadow\s*\(/gi,
  radiusDecl: /\b(border-radius|borderRadius|border-[a-z]+-radius|border[A-Z][a-zA-Z]*Radius)\s*:\s*([^;}\n]+)/g,
  colorDecl: /\b(background-color|backgroundColor|background|border-[a-z]+-color|borderColor|border-color|border|outline-color|outline|text-decoration-color|textDecorationColor|caret-color|accent-color|color|fill|stroke)\s*:\s*([^;}\n]+)/gi,
  styleNumProp:
    /\b(width|height|minWidth|maxWidth|minHeight|maxHeight|top|right|bottom|left|inset|margin|marginTop|marginRight|marginBottom|marginLeft|padding|paddingTop|paddingRight|paddingBottom|paddingLeft|gap|rowGap|columnGap|borderRadius|borderWidth|fontSize|letterSpacing)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g,
  timeContext: /transition|animation|duration|delay|animate/i,
  varFwm: /var\(\s*--fwm-[a-z0-9-]+\s*(?:,[^)]*)?\)/gi,
  word: /[A-Za-z][A-Za-z-]*/g,
  varOpen: /var\(\s*(--fwm-[a-z0-9-]+)/gi,
  /* A declaration, not a reference: the colon is what separates
     `--fwm-rule-w: calc(...)` from the `var(--fwm-rule-w)` that reads it. */
  customPropDecl: /(--fwm-[a-z0-9-]+)\s*:/g,
};

const HEX_LENGTHS = new Set([3, 4, 6, 8]);
const STYLE_FILE_EXT = new Set(['.css', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.htm']);
const KEYWORDS = /\b(none|inherit|initial|unset|revert|auto|currentcolor|transparent|solid|dashed|dotted|hidden)\b/gi;

/** Strip var() references and CSS keywords; what remains is a raw value. */
function residual(value) {
  return value.replace(RE.varFwm, ' ').replace(KEYWORDS, ' ').trim();
}

/**
 * A CSS declaration ends at `;`. A JS object property ends at the comma before
 * the next property. Without this, `{ borderRadius: 6, width: 384 }` captures
 * the whole object and swallows the second violation.
 */
function trimDeclValue(value, ext) {
  if (!JS_EXT.test(ext)) return value;
  const m = /,\s*[A-Za-z_$][\w$]*\s*:/.exec(value);
  return m ? value.slice(0, m.index) : value;
}


/**
 * Every `var(--fwm-*)` in a file, paired with its fallback if it has one.
 *
 * Balanced to the closing paren rather than the first one, because a fallback
 * may itself be a `var()`: `var(--fwm-ease-linear, var(--fwm-ease-mech))` is
 * one reference with a fallback, not a reference that ends at `--fwm-ease-mech`.
 * Nested references are returned too -- a fallback nobody can resolve is not a
 * fallback.
 */
function varRefs(src) {
  const out = [];
  RE.varOpen.lastIndex = 0;
  let m;
  while ((m = RE.varOpen.exec(src)) !== null) {
    const open = m.index + 3; // the `(` of `var(`
    let depth = 0;
    let close = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) { close = i; break; }
    }
    // Unterminated -- a stray `(` in a string literal, most likely. Skip this
    // one reference rather than the rest of the file: going quiet on everything
    // after a typo is the failure mode this whole rule is here to remove.
    if (close === -1) continue;
    const inner = src.slice(open + 1, close);
    const comma = inner.indexOf(',');
    out.push({
      index: m.index,
      end: close + 1,
      name: m[1],
      fallback: comma === -1 ? '' : inner.slice(comma + 1).trim(),
      text: src.slice(m.index, close + 1),
    });
  }
  return out;
}

/**
 * What each file is allowed to read: the shared tokens, plus whatever that file
 * declares for itself.
 *
 * Built once per run rather than per file, because the shared half of the
 * answer is the same everywhere and the token source is the only file whose
 * declarations any other file can see. `definersOf` exists only to make the
 * failure legible -- knowing a name is declared in `settings.css` is what turns
 * "this is undefined" into "you are reading somebody else's local".
 *
 * Declarations are read from masked source: a commented-out token is a note
 * about a token, not a token.
 */
function collectDefinitions(root, files) {
  const global = new Set();
  const localsByFile = new Map();
  const definersOf = new Map();
  for (const rel of files) {
    if (!STYLE_FILE_EXT.has(extOf(rel))) continue;
    if (isTestFile(rel)) continue;
    let raw;
    try {
      raw = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (!raw.includes('--fwm-')) continue;
    const names = new Set();
    for (const d of matches(RE.customPropDecl, maskComments(raw, extOf(rel)), (x) => x)) {
      names.add(d[1]);
    }
    if (names.size === 0) continue;
    localsByFile.set(rel, names);
    for (const name of names) {
      if (TOKEN_SOURCES.has(rel)) global.add(name);
      const definers = definersOf.get(name);
      if (definers) definers.push(rel);
      else definersOf.set(name, [rel]);
    }
  }
  return { global, localsByFile, definersOf };
}

/**
 * Rules run in order. A rule with `claims: true` marks the byte range it
 * explains, so later rules do not double-report the same characters (e.g.
 * `13px` inside `text-[13px]`).
 */
const RULES = [
  /*
   * A NAME THAT DOES NOT EXIST IS NOT AN ERROR IN CSS. IT IS NOTHING.
   *
   * `border: var(--fwm-tint-scan-line) solid var(--fwm-line)` with no such
   * property anywhere does not warn and does not fall back: the declaration is
   * thrown away and the border is invisible, on a screen somebody reads at
   * 70mph. Three of these shipped in two days -- `--fwm-tint-scan-line`,
   * `--fwm-space-5` and `--fwm-shadow-ink` -- and every rule above passed them,
   * because each of those rules asks whether a value IS a token and none asked
   * whether the token is real. Two rendered a transparent border and no
   * padding; nobody saw a missing 4px on a phone in a mount.
   *
   * The same hole swallows a reference that names something real but out of
   * reach. A component's own `--fwm-*` locals are legitimate and common -- they
   * are how a screen derives a stroke from the space scale without minting a
   * token -- but only that component's own subtree can read them. `node.css`
   * reading `--fwm-settings-rule-w` is reading a property SETTINGS declares on
   * `.fwm-settings`, a screen that is never NODE's ancestor. It resolves to
   * nothing for exactly the reason a typo does, and unlike a typo it survives
   * review, because the name is spelled correctly and does exist somewhere.
   * tokens.css already says this where it promoted `--fwm-rule-w`: "Referencing
   * another component's local from a third component is how you ship a border
   * that silently resolves to nothing, which is exactly what happened before
   * this existed." That promotion fixed the token. It could not fix the reads.
   *
   * A fallback is the one honest answer to "this may not be defined", so a
   * reference that has one is not this bug. `rotate(var(--fwm-vehicle-rotation,
   * 0deg))` is level until MapCanvas sets the heading, where a bare reference
   * would drop the whole transform and leave the arrow off-centre on first
   * paint. Stating what to do instead is the discipline being asked for. An
   * EMPTY fallback -- `var(--fwm-x,)` -- states nothing and still paints
   * nothing, so it is not one.
   *
   * Runs first, and claims nothing. Claiming would swallow a raw value sitting
   * in a fallback, and running later would let another rule's claimed range
   * hide a dangling reference inside it -- a silent failure suppressed by a
   * louder one is the whole shape of the bug this rule exists to stop.
   */
  {
    id: 'unresolved-var',
    why: 'var(--fwm-*) reference that resolves to nothing',
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => {
      const out = [];
      for (const ref of varRefs(ctx.masked)) {
        if (ctx.globalNames.has(ref.name)) continue;
        if (ctx.localNames.has(ref.name)) continue;
        if (ref.fallback !== '') continue;
        const elsewhere = (ctx.definersOf.get(ref.name) ?? []).filter((f) => f !== ctx.rel);
        out.push({
          index: ref.index,
          end: ref.end,
          text: ref.text,
          why: elsewhere.length > 0
            ? `${ref.name} is a component local of ${elsewhere.join(', ')}, not a token; ` +
              'that component is not an ancestor here, so this resolves to nothing'
            : `${ref.name} is not defined in tokens.css or in this file, so this ` +
              'resolves to nothing',
        });
      }
      return out;
    },
  },
  {
    id: 'tailwind-arbitrary',
    why: 'tailwind arbitrary value -- use a token-backed utility or a css class',
    claims: true,
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => matches(RE.arbitrary, ctx.masked, (m) => ({
      index: m.index,
      end: m.index + m[0].length,
      text: m[0],
      hintText: m[0].slice(m[0].indexOf('[') + 1, -1),
      hintCtx: m[0].slice(0, m[0].lastIndexOf('-[')),
    })),
  },
  {
    id: 'font-family',
    why: 'unshipped font -- only Chakra Petch, JetBrains Mono and system families ship',
    claims: true,
    applies: () => true,
    scan: (ctx) => {
      const out = [];
      for (const m of matches(RE.fontDecl, ctx.masked, (x) => x)) {
        const value = trimDeclValue(m[1], ctx.ext);
        const valueStart = m.index + m[0].length - m[1].length;
        let cursor = 0;
        for (const rawPart of value.split(',')) {
          const partStart = valueStart + cursor;
          cursor += rawPart.length + 1;
          const stripped = rawPart.replace(RE.varFwm, '').trim();
          if (stripped === '') continue;
          const name = stripped.replace(/^["']|["']$/g, '').trim().toLowerCase();
          if (ALLOWED_FONTS.has(name)) continue;
          out.push({
            index: partStart + (rawPart.length - rawPart.trimStart().length),
            end: partStart + rawPart.length,
            text: stripped,
          });
        }
        out.push({ index: m.index, end: valueStart + value.length, text: '', claimOnly: true });
      }
      for (const m of matches(RE.googleFont, ctx.masked, (x) => x)) {
        if (!lineTextAt(ctx.masked, ctx.starts, m.index).includes('fonts.googleapis.com')) continue;
        for (const fam of decodeURIComponent(m[1]).split('|')) {
          const name = fam.split(':')[0].replace(/\+/g, ' ').trim().toLowerCase();
          if (ALLOWED_FONTS.has(name)) continue;
          out.push({ index: m.index, end: m.index + m[0].length, text: name });
        }
      }
      return out;
    },
  },
  {
    id: 'shadow',
    why: 'raw shadow -- use var(--fwm-glow-alert)',
    claims: true,
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => {
      const out = [];
      for (const m of matches(RE.shadowDecl, ctx.masked, (x) => x)) {
        const value = trimDeclValue(m[2], ctx.ext);
        const end = m.index + m[0].length - m[2].length + value.length;
        if (/[0-9#]/.test(residual(value))) {
          out.push({ index: m.index, end, text: value.trim() });
        } else {
          out.push({ index: m.index, end, text: '', claimOnly: true });
        }
      }
      for (const m of matches(RE.dropShadow, ctx.masked, (x) => x)) {
        out.push({ index: m.index, end: m.index + m[0].length, text: m[0] });
      }
      return out;
    },
  },
  {
    id: 'radius',
    why: 'raw radius -- use var(--fwm-radius-0|1|2|full)',
    claims: true,
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => {
      const out = [];
      for (const m of matches(RE.radiusDecl, ctx.masked, (x) => x)) {
        const value = trimDeclValue(m[2], ctx.ext);
        const end = m.index + m[0].length - m[2].length + value.length;
        if (/\d/.test(residual(value))) {
          out.push({ index: m.index, end, text: value.trim() });
        } else {
          out.push({ index: m.index, end, text: '', claimOnly: true });
        }
      }
      return out;
    },
  },
  {
    id: 'easing',
    why: 'raw easing -- use var(--fwm-ease-out) or var(--fwm-ease-mech)',
    claims: true,
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => {
      const out = [];
      for (const m of matches(RE.cubic, ctx.masked, (x) => x)) {
        const close = ctx.masked.indexOf(')', m.index);
        const end = close === -1 ? m.index + m[0].length : close + 1;
        out.push({ index: m.index, end, text: ctx.masked.slice(m.index, end) });
      }
      for (const m of matches(RE.easeWord, ctx.masked, (x) => x)) {
        out.push({ index: m.index, end: m.index + m[0].length, text: m[0] });
      }
      for (const m of matches(RE.easeBare, ctx.masked, (x) => x)) {
        if (!RE.timeContext.test(lineTextAt(ctx.masked, ctx.starts, m.index))) continue;
        out.push({ index: m.index, end: m.index + m[1].length, text: m[1] });
      }
      return out;
    },
  },
  {
    id: 'hex-color',
    why: 'raw hex color -- use a var(--fwm-*) color token',
    /**
     * NOT IN GENERATED DATA.
     *
     * This rule exists to stop a hand-written colour appearing where a token
     * belongs. `apps/pwa/public/cameras` is neither hand-written nor a place a
     * colour could be used: it is the OSM archive, generated by
     * `scripts/fetch-cameras.mjs` and `scripts/enrich-cameras.mjs`.
     *
     * It began failing the moment the archive started carrying the mappers'
     * own tags, because OSM writes a route number as `ref=#349` and a 3-digit
     * `#349` is indistinguishable from a hex colour by regex. 295 violations,
     * every one of them a road sign.
     *
     * Scoped by DIRECTORY rather than by adding 295 allowlist entries: the
     * next enrichment would add more, and an allowlist that grows with the
     * data is one nobody reads.
     */
    applies: (ctx) => !ctx.rel.startsWith('apps/pwa/public/cameras/'),
    scan: (ctx) => matches(RE.hex, ctx.masked, (m) =>
      HEX_LENGTHS.has(m[1].length)
        ? { index: m.index, end: m.index + m[0].length, text: m[0] }
        : null),
  },
  {
    id: 'color-fn',
    why: 'raw color function -- use a var(--fwm-*) color token',
    claims: true,
    applies: () => true,
    scan: (ctx) => matches(RE.colorFn, ctx.masked, (m) => {
      const close = ctx.masked.indexOf(')', m.index);
      const end = close === -1 ? m.index + m[0].length : close + 1;
      return { index: m.index, end, text: ctx.masked.slice(m.index, end) };
    }),
  },
  {
    id: 'named-color',
    why: 'css named color -- use a var(--fwm-*) color token',
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => {
      const out = [];
      for (const m of matches(RE.colorDecl, ctx.masked, (x) => x)) {
        const value = trimDeclValue(m[2], ctx.ext);
        const valueStart = m.index + m[0].length - m[2].length;
        const cleaned = value.replace(RE.varFwm, (s) => ' '.repeat(s.length));
        for (const w of matches(RE.word, cleaned, (x) => x)) {
          if (!NAMED_COLORS.has(w[0].toLowerCase())) continue;
          out.push({ index: valueStart + w.index, end: valueStart + w.index + w[0].length, text: w[0] });
        }
      }
      return out;
    },
  },
  {
    id: 'duration',
    why: 'raw duration -- use var(--fwm-dur-instant|fast|base|alert)',
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => matches(RE.time, ctx.masked, (m) => {
      if (Number(m[1]) === 0) return null; // a zero duration is "off", not a design value
      if (m[2] === 's' && !RE.timeContext.test(lineTextAt(ctx.masked, ctx.starts, m.index))) return null;
      return { index: m.index, end: m.index + m[0].length, text: m[0] };
    }),
  },
  {
    id: 'length',
    why: 'raw length -- use var(--fwm-space-*|text-*|touch-min|nav-h|header-h)',
    applies: (ctx) => STYLE_FILE_EXT.has(ctx.ext),
    scan: (ctx) => {
      // A zero length carries no design decision, and `env(safe-area-inset-*, 0px)`
      // needs the unit for the fallback to parse on older WebKit.
      const out = matches(RE.length, ctx.masked, (m) => (
        Number(m[1]) === 0 ? null : { index: m.index, end: m.index + m[0].length, text: m[0] }
      ));
      // React inline styles turn unitless numbers into px, so `{ width: 384 }`
      // is a hardcoded length wearing a disguise.
      if (JS_EXT.test(ctx.ext)) {
        for (const m of matches(RE.styleNumProp, ctx.masked, (x) => x)) {
          if (Number(m[2]) === 0) continue;
          out.push({ index: m.index, end: m.index + m[0].length, text: m[2], hintCtx: m[1] });
        }
      }
      return out;
    },
  },
  {
    id: 'hover',
    why: 'hover state -- this is a touch-first product; hover never fires on the target device',
    remedy: 'delete the hover rule, or move the affect to :active / a pressed state',
    applies: () => true,
    scan: (ctx) => [
      ...matches(RE.hoverTw, ctx.masked, (m) => ({
        index: m.index, end: m.index + m[0].length, text: m[0],
      })),
      ...matches(RE.hoverCss, ctx.masked, (m) => ({
        index: m.index, end: m.index + m[0].length, text: m[0],
      })),
    ],
  },
];

const RULE_REMEDY = {
  hover: 'delete the hover rule, or move the affect to :active / a pressed state',
  'unresolved-var':
    'point it at a shared token, declare it on this component, or give it a fallback',
  asset: `derive it from ${BRAND_MASTER}, or add an allowlist entry with a reason`,
};

function matches(re, src, map) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const v = map(m);
    if (v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token parsing (for --fix-hint)
// ---------------------------------------------------------------------------

function parseTokens(root) {
  const file = join(root, 'apps/pwa/src/styles/tokens.css');
  if (!existsSync(file)) return [];
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  const seen = new Set();
  const re = /(--fwm-[a-z0-9-]+)\s*:\s*([^;}]+)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue; // :root wins; mode blocks only remap it
    seen.add(name);
    const value = m[2].trim();
    out.push({
      name, value,
      kind: tokenKind(value),
      rgb: toRgb(value),
      px: toPx(value),
      ms: toMs(value),
    });
  }
  return out;
}

function tokenKind(value) {
  if (/^#|^rgb|^hsl/i.test(value)) return 'color';
  if (/^-?[\d.]+(px|rem|em)$/i.test(value) || /^0$/.test(value)) return 'length';
  if (/^-?[\d.]+m?s$/i.test(value)) return 'duration';
  if (/cubic-bezier/i.test(value)) return 'easing';
  if (/,/.test(value) && /['a-z]/i.test(value)) return 'font';
  return 'other';
}

function toRgb(value) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    if (h.length < 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value.trim());
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3])] : null;
}

function toPx(value) {
  const m = /^(-?[\d.]+)(px|rem|em)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return (m[2] ?? 'px').toLowerCase() === 'px' ? n : n * 16;
}

function toMs(value) {
  const m = /^(-?[\d.]+)(ms|s)$/i.exec(value.trim());
  if (!m) return null;
  return m[2].toLowerCase() === 'ms' ? Number(m[1]) : Number(m[1]) * 1000;
}

/** Steers the nearest-token search toward the right family. The context is the
 *  css property, the react style prop, or the tailwind utility prefix. */
const NAME_BIAS = [
  [/font-size|fontsize|letter-spacing|letterSpacing|\btext\b|\bleading\b/i, /^--fwm-text-/],
  [/radius|\brounded\b/i, /^--fwm-radius-/],
  [/gap|margin|padding|space|inset|^(?:[pm][xytrbl]?)$/i, /^--fwm-space-/],
];

/** exact value match first, then nearest numeric. */
function suggest(tokens, violation) {
  if (tokens.length === 0) return null;
  const text = (violation.hintText ?? violation.text ?? '').trim();
  if (text === '') return null;
  const norm = (v) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  const wanted = norm(text);

  for (const t of tokens) if (norm(t.value) === wanted) return `var(${t.name})`;

  const wantRgb = toRgb(text);
  if (wantRgb) {
    for (const t of tokens) {
      if (t.rgb && t.rgb[0] === wantRgb[0] && t.rgb[1] === wantRgb[1] && t.rgb[2] === wantRgb[2]) {
        return `var(${t.name})`;
      }
    }
    let best = null;
    for (const t of tokens) {
      if (!t.rgb) continue;
      const d = (t.rgb[0] - wantRgb[0]) ** 2 + (t.rgb[1] - wantRgb[1]) ** 2 + (t.rgb[2] - wantRgb[2]) ** 2;
      if (!best || d < best.d) best = { d, t };
    }
    return best ? `var(${best.t.name}) /* nearest color: ${best.t.value} */` : null;
  }
  if (NAMED_COLORS.has(wanted)) {
    const colors = tokens.filter((t) => t.kind === 'color').map((t) => t.name);
    return colors.length ? `one of ${colors.slice(0, 4).join(', ')} ... (see tokens.css)` : null;
  }
  if (violation.rule === 'easing') {
    const eases = tokens.filter((t) => t.kind === 'easing');
    return eases.length ? eases.map((t) => `var(${t.name})`).join(' | ') : null;
  }
  if (violation.rule === 'font-family') {
    const fonts = tokens.filter((t) => t.kind === 'font');
    return fonts.length ? fonts.map((t) => `var(${t.name})`).join(' | ') : null;
  }
  if (violation.rule === 'shadow') {
    const glow = tokens.find((t) => /glow/.test(t.name));
    return glow ? `var(${glow.name})` : null;
  }
  if (violation.rule === 'radius' && text.includes('%')) {
    const full = tokens.find((t) => t.name === '--fwm-radius-full');
    return full ? `var(${full.name})` : null;
  }

  const ms = toMs(text);
  if (ms !== null && violation.rule === 'duration') {
    return nearest(tokens.filter((t) => t.kind === 'duration'), (t) => t.ms, ms, 'ms');
  }
  const px = toPx(text);
  if (px !== null) {
    let pool = tokens.filter((t) => t.kind === 'length');
    const ctx = `${violation.hintCtx ?? violation.lineText ?? ''} ${text}`;
    for (const [ctxRe, nameRe] of NAME_BIAS) {
      if (!ctxRe.test(ctx)) continue;
      const biased = pool.filter((t) => nameRe.test(t.name));
      if (biased.length) { pool = biased; break; }
    }
    return nearest(pool, (t) => t.px, px, 'px');
  }
  return null;
}

/** Nearest token, but only when it is actually near -- a wild guess is worse
 *  than admitting the token set does not cover the value. */
function nearest(pool, get, want, unit) {
  let best = null;
  for (const t of pool) {
    const v = get(t);
    if (v === null || v === undefined) continue;
    const d = Math.abs(v - want);
    if (!best || d < best.d) best = { d, t, v };
  }
  if (!best) return null;
  if (want === 0 || best.d > Math.max(1, Math.abs(want) * 0.5)) return null;
  const detail = best.d === 0 ? '' : ` /* ${best.v}${unit}, nearest to ${want}${unit} */`;
  return `var(${best.t.name})${detail}`;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function scanFile(root, rel, defs) {
  const ext = extOf(rel);
  let raw;
  try {
    raw = readFileSync(join(root, rel), 'utf8');
  } catch {
    return [];
  }
  const masked = maskComments(raw, ext);
  const starts = lineIndex(raw);
  // Rebuilt here only when this file is scanned on its own. A whole run shares
  // one index, because reading it per file would re-read tokens.css 9000 times.
  const d = defs ?? collectDefinitions(root, [...TOKEN_SOURCES, rel]);
  const ctx = {
    rel, ext, raw, masked, starts,
    globalNames: d.global,
    localNames: d.localsByFile.get(rel) ?? new Set(),
    definersOf: d.definersOf,
  };
  const isTokenSource = TOKEN_SOURCES.has(rel);

  const claimed = [];
  const seen = new Set();
  const found = [];

  for (const rule of RULES) {
    if (!rule.applies(ctx)) continue;
    if (isTokenSource && TOKEN_SOURCE_EXEMPT_RULES.has(rule.id)) continue;
    for (const hit of rule.scan(ctx)) {
      if (rule.claims) claimed.push([hit.index, hit.end]);
      if (hit.claimOnly) continue;
      if (isClaimed(claimed, hit.index, rule.claims ? hit : null)) continue;
      const key = `${hit.index}:${hit.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { line, col } = locate(starts, hit.index);
      found.push({
        file: rel,
        line,
        col,
        rule: rule.id,
        // A hit may explain itself: two `unresolved-var` findings fail the same
        // way and are fixed differently, and the fix is what the reader needs.
        why: hit.why ?? rule.why,
        text: hit.text,
        hintText: hit.hintText,
        hintCtx: hit.hintCtx,
        lineText: lineTextAt(raw, starts, hit.index).trim(),
      });
    }
  }
  found.sort((a, b) => a.line - b.line || a.col - b.col);
  return found;
}

function isClaimed(claimed, index, self) {
  for (const [s, e] of claimed) {
    if (self && s === self.index && e === self.end) continue;
    if (index >= s && index < e) return true;
  }
  return false;
}

function scanAssets(root, files) {
  const out = [];
  for (const rel of files) {
    if (!IMAGE_EXT.has(extOf(rel))) continue;
    if (!rel.startsWith('apps/pwa/public/') && !rel.startsWith('apps/pwa/src/')) continue;
    if (GENERATED_ASSETS.has(rel) || SUPPLIED_ASSETS.has(rel) || GENERATED_ICON_RE.test(rel)) continue;
    out.push({
      file: rel,
      line: 1,
      col: 1,
      rule: 'asset',
      why: `brand image not derived from ${BRAND_MASTER} or ${ART_MASTER}`,
      text: rel,
      lineText: '',
    });
  }
  return out;
}

function runCheck(opts) {
  const root = opts.root;
  const allowlist = loadAllowlist(opts.allowlist);
  const files = collectFiles(root);
  const defs = collectDefinitions(root, files);

  const violations = [];
  const exempted = [];
  let scanned = 0;

  for (const rel of files) {
    if (isTestFile(rel)) continue;
    if (!TEXT_EXT.has(extOf(rel))) continue;
    scanned++;
    for (const v of scanFile(root, rel, defs)) {
      const entry = isAllowed(allowlist, v);
      if (entry) exempted.push({ ...v, reason: entry.reason });
      else violations.push(v);
    }
  }
  for (const v of scanAssets(root, files)) {
    const entry = isAllowed(allowlist, v);
    if (entry) exempted.push({ ...v, reason: entry.reason });
    else violations.push(v);
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);

  const byRule = {};
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

  return { root, filesScanned: scanned, totalFiles: files.length, violations, exempted, byRule };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function hintFor(tokens, v) {
  if (RULE_REMEDY[v.rule]) return RULE_REMEDY[v.rule];
  const s = suggest(tokens, v);
  return s ?? 'no token covers this value -- add a DESIGN-GAPS.md entry before inventing one';
}

function report(result, opts) {
  const tokens = opts.fixHint ? parseTokens(result.root) : [];
  const out = [];
  if (result.violations.length > 0) {
    out.push('', 'design-value violations', '-----------------------');
  }
  for (const v of result.violations) {
    out.push(`${v.file}:${v.line}:${v.col} - ${v.rule} - ${v.text || v.lineText}`);
    out.push(`    ${v.why}`);
    if (opts.fixHint) out.push(`    fix-hint: ${hintFor(tokens, v)}`);
  }
  out.push('', 'summary', '-------');
  out.push(`files scanned:   ${result.filesScanned}`);
  out.push(`violations:      ${result.violations.length}`);
  for (const id of ALL_RULE_IDS) {
    if (result.byRule[id]) out.push(`  ${id.padEnd(18)} ${result.byRule[id]}`);
  }
  if (result.exempted.length > 0) out.push(`allowlisted:     ${result.exempted.length}`);
  out.push(`exit code:       ${result.violations.length > 0 ? 1 : 0}`, '');
  return out.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  let result;
  try {
    result = runCheck(opts);
  } catch (err) {
    if (err instanceof AllowlistError) {
      process.stderr.write(`check-design-values: ${err.message}\n`);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: err.message, exitCode: 1 }, null, 2)}\n`);
      }
      process.exit(1);
    }
    throw err;
  }
  const failed = result.violations.length > 0;
  if (opts.json) {
    const tokens = opts.fixHint ? parseTokens(result.root) : [];
    process.stdout.write(`${JSON.stringify({
      ok: !failed,
      filesScanned: result.filesScanned,
      byRule: result.byRule,
      violations: result.violations.map((v) => ({
        file: v.file,
        line: v.line,
        col: v.col,
        rule: v.rule,
        text: v.text,
        why: v.why,
        ...(opts.fixHint ? { fixHint: hintFor(tokens, v) } : {}),
      })),
      allowlisted: result.exempted.map((v) => ({
        file: v.file, line: v.line, rule: v.rule, text: v.text, reason: v.reason,
      })),
      exitCode: failed ? 1 : 0,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(report(result, opts));
  }
  process.exit(failed ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename;
if (invokedDirectly) main();

export {
  runCheck, loadAllowlist, AllowlistError, parseTokens, suggest, maskComments,
  pathMatcher, scanFile, collectDefinitions, varRefs, ALL_RULE_IDS,
};
