/**
 * THE SESSION BEST: a max over rounds, held in the module, never written down.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { noteRound, sessionBestHits } from './score.ts';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

describe('sessionBest', () => {
  it('is the max of the rounds noted, and ignores nonsense', () => {
    expect(sessionBestHits()).toBe(0);
    expect(noteRound(3)).toBe(3);
    expect(noteRound(1)).toBe(3);
    expect(noteRound(7.9)).toBe(7);
    expect(noteRound(Number.NaN)).toBe(7);
    expect(noteRound(-4)).toBe(7);
    expect(sessionBestHits()).toBe(7);
  });

  it('resets only on a module reload', async () => {
    noteRound(9);
    vi.resetModules();
    const fresh = await import('./score.ts');
    expect(fresh.sessionBestHits()).toBe(0);
    expect(sessionBestHits()).toBe(9);
  });

  it('contains no camera id and touches no persistence', () => {
    const text = readFileSync(`${HERE}/score.ts`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(text).not.toMatch(/cameraId|camera_id|nearest|persist|localStorage|indexedDB|fetch\(/);
  });
});
