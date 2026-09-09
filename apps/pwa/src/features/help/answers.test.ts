import { describe, expect, it } from 'vitest';

import { HELP_SECTIONS, citedFiles } from './answers.ts';

/**
 * That every cited file EXISTS is checked by `scripts/check-help-citations.mjs`
 * and wired into `pnpm lint`, not here: this suite runs under the app's
 * tsconfig, which deliberately exposes no node filesystem types. The check
 * matters too much to skip, so it lives where it can read a disk.
 */
describe('the privacy answers', () => {
  it('cites at least one file per claim, in a repo-relative shape', () => {
    for (const file of citedFiles()) {
      expect(file).not.toMatch(/^[/.]/);
      expect(file).toMatch(/\.(ts|tsx|mjs|md|json)$/);
    }
  });

  it('never makes a claim it cannot point at code for', () => {
    for (const section of HELP_SECTIONS) {
      for (const answer of section.answers) {
        expect(answer.checkIn.length).toBeGreaterThan(0);
      }
    }
  });

  it('answers the questions a driver actually asks', () => {
    const questions = HELP_SECTIONS.flatMap((s) => s.answers.map((a) => a.question)).join(' | ');

    expect(questions).toContain('does my location leave this phone');
    expect(questions).toContain('do you store my licence plate');
    expect(questions).toContain('where are my settings saved');
    expect(questions).toContain('is there any analytics');
    expect(questions).toContain('can I delete everything');
  });

  it('says the uncomfortable part out loud', () => {
    const answers = HELP_SECTIONS.flatMap((s) => s.answers.map((a) => a.answer)).join(' ');

    // The thing a driver most needs to know is what this app CANNOT do. If
    // this ever fails, the page has drifted into marketing.
    expect(answers).toContain('an empty dial means nothing is MAPPED here');
    expect(answers).toContain('tiles.darkroute.ai');
    expect(answers).toContain('cloudflare receives those requests');
    expect(answers).toContain('on iphone the key is hidden');
    expect(answers).toContain('do not');
  });

  it('does not make an uncheckable no-logs promise', () => {
    const answers = HELP_SECTIONS.flatMap((s) => s.answers.map((a) => a.answer)).join(' ');

    expect(answers).not.toContain('keep no logs');
    expect(answers).not.toContain('keeps no logs');
  });

  it('keeps the chrome voice: no marketing, no hedging', () => {
    const answers = HELP_SECTIONS.flatMap((s) => s.answers.map((a) => a.answer)).join(' ');

    for (const banned of [
      'we take your privacy seriously',
      'industry-standard',
      'best practices',
      'military-grade',
      'rest assured',
    ]) {
      expect(answers.toLowerCase()).not.toContain(banned);
    }
  });
});
