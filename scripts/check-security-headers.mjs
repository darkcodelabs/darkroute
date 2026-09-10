/**
 * Prove the Cloudflare Pages header policy survives into the deploy artifact.
 *
 * This deliberately runs after `vite build`. A Vite `closeBundle` hook also
 * runs inside vite-plugin-pwa's secondary service-worker build, where public
 * files have not been copied; checking there made every otherwise-valid build
 * fail for the wrong reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'apps/pwa/public/_headers');
const BUILT = resolve(ROOT, 'apps/pwa/dist/_headers');
const DESKTOP_SOURCE = resolve(ROOT, 'apps/desktop/public/_headers');

/** Cloudflare respects no-transform when deciding whether to inject its beacon. */
export function verifyNoAnalyticsInjection(text, paths) {
  const rules = new Map();
  let current;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      rules.set(current, []);
    } else if (current) rules.get(current).push(line.trim());
  }
  for (const path of paths) {
    const cache = rules.get(path)?.find((line) => /^Cache-Control:/i.test(line));
    if (!cache?.slice(cache.indexOf(':') + 1).split(',').some((value) => value.trim().toLowerCase() === 'no-transform')) {
      throw new Error(`${path} needs Cache-Control: no-transform to prevent analytics injection`);
    }
  }
}

export function verifySecurityHeaders(checkDist = false) {
  const source = readFileSync(SOURCE);
  const text = source.toString('utf8');
  if (!text.includes('Content-Security-Policy:')) {
    throw new Error('public/_headers has no Content-Security-Policy');
  }
  verifyNoAnalyticsInjection(text, ['/', '/index.html', '/alpr/', '/alpr/index.html']);
  verifyNoAnalyticsInjection(readFileSync(DESKTOP_SOURCE, 'utf8'), ['/', '/index.html']);
  if (checkDist) {
    const built = readFileSync(BUILT);
    if (!built.equals(source)) {
      throw new Error('dist/_headers differs from the reviewed public/_headers');
    }
  }
  return source.byteLength;
}

function main() {
  const checkDist = process.argv.slice(2).includes('--dist');
  const bytes = verifySecurityHeaders(checkDist);
  process.stdout.write(
    `security headers${checkDist ? ' (public = dist)' : ''}: ${String(bytes)} exact bytes, CSP present\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
