/**
 * THE DRAWING FILTER GOES TO ONE PLACE, AND THE TEXT SAYS SO.
 *
 * =============================================================================
 * WHY A SOURCE TEST
 * =============================================================================
 * `ownerFilter.engine.test.ts` proves the engine's answer is unchanged today.
 * It cannot prove the NEXT change is safe, because the mistake that would break
 * this is a single word: somebody writes `drawn` where `cameras` or
 * `assessments` belongs, in a file that is about to grow a control panel and a
 * card row. That edit compiles, renders, and only shows up as a driver not
 * being warned.
 *
 * Same reasoning as `DriveScreen.fullscreen.test.ts` gives for its own source
 * assertions: the mistake is one line and it is visible in the text.
 *
 * The assertions are deliberately narrow so that the panel and the card row
 * that are still to be built do not have to fight them. They constrain where
 * the FILTERED array may appear, not what the screen may contain.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function read(rel: string): string {
  const found = [rel, `apps/pwa/${rel}`]
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((path) => {
      try {
        readFileSync(path, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
  expect(found, `could not locate ${rel}`).toBeDefined();
  return readFileSync(found as string, 'utf8');
}

/** Source with block and line comments stripped, so prose cannot satisfy a test. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('where the drawing filter is allowed to reach', () => {
  it('is read on DRIVE at all, or every assertion below is vacuous', () => {
    const source = code('src/features/drive/DriveScreen.tsx');
    expect(source).toContain('useMapOwnerFilter');
    expect(source).toContain('visibleCameras');
  });

  it('is applied exactly once, in the memo that feeds the map', () => {
    const source = code('src/features/drive/DriveScreen.tsx');
    const applications = source.match(/visibleCameras\(/g) ?? [];
    // A second call site means a second thing has been filtered, and the only
    // thing on this screen that may be filtered is the picture.
    expect(applications).toHaveLength(1);
    expect(source).toContain('const drawn = useMemo(() => visibleCameras(cameras, mapOwnerFilter)');
  });

  it('hands the filtered array to the map prop and to nothing else', () => {
    const source = code('src/features/drive/DriveScreen.tsx');
    // Every mention of the identifier, ignoring longer words that contain it.
    const mentions = source.match(/\bdrawn\b/g) ?? [];
    // Three: the declaration, and the two halves of the ternary on the prop.
    expect(mentions).toHaveLength(3);
    expect(source).toContain('cameras={drawn.length > 0 ? drawn : NO_CAMERAS}');
  });

  it('never lets the filter into the two labelled markers', () => {
    const source = code('src/features/drive/DriveScreen.tsx');
    // `labelled` is built from the ASSESSMENTS - the cameras the app is
    // currently warning about - and it keeps its dot and its distance on the
    // map even when that owner class is hidden. That is the safety property
    // made visible, not a leak, and the comment above the memo says so.
    const labelled = source.slice(source.indexOf('const labelled = useMemo'));
    const memo = labelled.slice(0, labelled.indexOf('[assessments],'));
    expect(memo).not.toContain('mapOwnerFilter');
    expect(memo).not.toContain('drawn');
    expect(memo).toContain('assessments.slice(0, 2)');
  });

  it('keeps the alerting owner filter out of the map filter module', () => {
    // `ownerTypesEnabled` governs ALERTING. The moment the drawing filter
    // imports it, or is read beside it, the two are one filter and this
    // feature has become the defect it was written to avoid.
    // Comment-stripped, because the module's own header NAMES the alerting
    // filter in order to warn a reader off it. Prose about the trap is the
    // point; code touching it is the defect.
    const module = code('src/features/map/ownerFilter.ts');
    expect(module).not.toContain('setOwnerTypeEnabled');
    expect(module).not.toContain('ownerTypesEnabled');
  });

  it('keeps it out of the two files where the merge would actually be written', () => {
    // The check above guards the pure module, which is the file least likely to
    // grow the bug: it takes an array and a filter and returns an array, and
    // there is nowhere in it to put a settings read.
    //
    // The merge would be written in the COMPONENTS - the panel that offers the
    // choice and the screen that applies it. `MapControlPanel.tsx:28-30` states
    // the invariant in its own header ("this file must never import
    // setOwnerTypeEnabled or useOwnerTypesEnabled") and nothing tested the file
    // the invariant is about.
    for (const path of [
      'src/features/map/MapControlPanel.tsx',
      'src/features/drive/DriveScreen.tsx',
    ]) {
      const module = code(path);
      expect(module, `${path} must not read the ALERTING owner filter`).not.toContain(
        'setOwnerTypeEnabled',
      );
      expect(module, `${path} must not read the ALERTING owner filter`).not.toContain(
        'useOwnerTypesEnabled',
      );
    }
  });

  it('is not applied inside the shared cameras selector', () => {
    // `useCachedCameras()` feeds Look up's denominator, the WATCHING pill and
    // the drive card's record lookups. Filtering there is how a display choice
    // becomes a claim about what exists.
    const store = code('src/stores/cameras.ts');
    expect(store).not.toContain('mapOwnerFilter');
    expect(store).not.toContain('visibleCameras');
  });

  it('is not read by the alert loop', () => {
    const loop = code('src/services/alerts/engineLoop.ts');
    expect(loop).not.toContain('mapOwnerFilter');
    expect(loop).not.toContain('visibleCameras');
  });
});
