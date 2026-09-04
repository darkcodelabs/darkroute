/**
 * LOOKUP LINKS. IT MUST NEVER QUERY.
 *
 * =============================================================================
 * WHY THIS IS A TEST
 * =============================================================================
 * haveibeenflocked.com publishes `Allow: /` and `Disallow: /api/`. Linking is
 * permitted in as many words; calling the endpoint their own plate search uses
 * is refused in as many words. This screen exists because linking needs
 * nobody's permission, and the whole justification collapses the moment
 * somebody adds a `fetch` to it "just to prefill the result".
 *
 * That would not be a bug that breaks anything. It would work, it would look
 * like an improvement, and it would be us helping ourselves to a
 * donation-funded nonprofit's infrastructure against a machine-readable
 * refusal. Nothing else in this repo would notice.
 *
 * =============================================================================
 * AND THE PLATE MUST NOT TRAVEL IN A URL
 * =============================================================================
 * A plate in a URL is a plate in a browser history, a referrer header and a
 * server log. The hand-off puts it on the clipboard and the driver pastes it,
 * which keeps the decision with the person whose plate it is.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function screenSource(): string {
  const found = [
    'src/features/lookup/PlateHandoffV1.tsx',
    'apps/pwa/src/features/lookup/PlateHandoffV1.tsx',
  ]
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found, 'PlateHandoffV1.tsx not found').toBeDefined();
  return readFileSync(found as string, 'utf8');
}

function handoffSource(): string {
  const found = ['src/features/lookup/handoff.ts', 'apps/pwa/src/features/lookup/handoff.ts']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found).toBeDefined();
  return readFileSync(found as string, 'utf8');
}

describe('the plate hand-off', () => {
  it('NEVER calls their service', () => {
    // The one line that would turn a permitted link into a refused query.
    const source = screenSource();
    for (const call of ['fetch(', 'XMLHttpRequest', 'axios', 'EventSource(', 'WebSocket(']) {
      expect(
        source,
        `LookupScreen uses ${call}. Their robots.txt refuses /api/; this screen may only link.`,
      ).not.toContain(call);
    }
  });

  it('never builds a url carrying the plate', () => {
    // A plate in a URL is a plate in a history, a referrer and a server log.
    const source = `${screenSource()}\n${handoffSource()}`;
    expect(source).not.toMatch(/haveibeenflocked\.com\/[^'"\s]*\$\{/);
    expect(source).not.toContain('URLSearchParams');
    expect(source).not.toMatch(/\?plate=/);
  });

  it('opens their site and nowhere else', () => {
    const handoff = handoffSource();
    const urls = [...handoff.matchAll(/https?:\/\/[^'"\s]+/g)].map((m) => m[0]);
    // Every URL in the hand-off is their homepage, which is the one path
    // `Allow: /` covers without ambiguity.
    for (const url of urls) {
      expect(url, `hand-off references ${url}`).toBe('https://haveibeenflocked.com/');
    }
  });

  it('opens with noopener and no referrer', () => {
    // `noopener` so their page cannot reach back through window.opener, and no
    // referrer so their logs do not record which of our screens somebody was on.
    expect(handoffSource()).toContain('noopener,noreferrer');
  });

  it('does not keep what was typed', () => {
    // The field is cleared on hand-off. This screen is not the plate vault,
    // which is a separate encrypted path a driver opts into.
    //
    // Comments are stripped first: this file's own prose names the vault in
    // order to say it is NOT used here, and a check that cannot tell a mention
    // from a call fails on documentation.
    const source = screenSource();
    expect(source).toContain("setPlate('')");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const store of ['localStorage', 'sessionStorage', 'indexedDB', 'plateVault']) {
      expect(code, `LookupScreen touches ${store}`).not.toContain(store);
    }
  });

  it('claims no result it cannot have', () => {
    // Without their API the app cannot know about a hit. Inventing one, or
    // scraping for it, are the only two ways to have that banner.
    const source = screenSource().toLowerCase();
    for (const claim of ['you were flocked', 'hit found', 'no hits', 'your plate was searched']) {
      expect(source, `LookupScreen asserts "${claim}" and cannot know it`).not.toContain(claim);
    }
  });
});
