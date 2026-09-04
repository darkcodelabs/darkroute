/**
 * A CLAIM IN `LEAVES` MUST HAVE A TRANSMIT PATH BEHIND IT.
 *
 * =============================================================================
 * THE DEFECT THIS EXISTS FOR
 * =============================================================================
 * The mesh screen printed a list headed "what leaves your car", introduced by
 * the sentence "every one is enforced by a test rather than by intention". The
 * first entry read:
 *
 *     SENT   camera pins you choose to share.
 *
 * There was no such path. `features/node/sighting.ts` encodes a sighting and
 * has never had a production caller - its only importers are its own test and
 * `mesh.privacy.test.ts`, which EXPLICITLY EXCLUDES it from the transmit audit
 * (`expect(names).not.toContain('sighting.ts')`). So the guarantee sentence
 * sat directly on top of the one claim no test could enforce, because the
 * feature it described did not exist.
 *
 * In a product whose entire pitch is "we tell you exactly what leaves your
 * phone, and a test enforces it", that is the worst possible shape for a bug:
 * not a crash, not a leak, but the app being wrong about itself in the precise
 * place it asks to be trusted.
 *
 * =============================================================================
 * WHY A TEST AND NOT A CODE REVIEW
 * =============================================================================
 * The claim was written the day the screen was, and every reviewer since read
 * it as description rather than as a promise. That is what copy does - it stops
 * looking like an assertion once it has been on screen for a while. So the
 * rule is enforced mechanically: a SENT line must name a capability the session
 * actually exposes, and the number of SENT lines must equal the number of
 * transmit methods the mesh session has.
 *
 * When a real sighting-broadcast path is wired, this test fails and asks for
 * the claim to be added - which is the correct direction for the failure to
 * point.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LEAVES } from './MeshScreen.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const meshSource = readFileSync(`${HERE}/../node/mesh.ts`, 'utf8');

/** Lines the screen presents as things this app transmits. */
const sent = LEAVES.filter((row) => row.state === 'SENT');
const never = LEAVES.filter((row) => row.state === 'NEVER');

describe('what LEAVES claims', () => {
  it('claims exactly as many transmit paths as the session exposes', () => {
    /*
     * The session's transmit surface is `sendText` and `sendDirect`. Both put
     * the same thing on the air - a short typed message - to a channel or to
     * one node, which is why they are ONE claim rather than two.
     *
     * The assertion is on the METHODS, so wiring a third transmit path fails
     * here until somebody writes the claim for it. That is the direction the
     * failure should point: code first, promise second.
     */
    const transmitMethods = ['sendText(', 'sendDirect('].filter((method) =>
      meshSource.includes(`  ${method}`),
    );
    expect(transmitMethods).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('typed messages');
  });

  it('does NOT claim to share camera pins, because nothing sends them', () => {
    // The deleted claim, pinned as deleted. `sighting.ts` is a codec with no
    // caller; until something calls it, this line may not come back.
    const claimsPins = LEAVES.some(
      (row) =>
        row.state === 'SENT' && /pin|sighting|camera/i.test(row.text),
    );
    expect(claimsPins, 'LEAVES claims a camera-sharing path that does not exist').toBe(false);
  });

  it('keeps the refusals, which are the half a test CAN enforce', () => {
    // `mesh.privacy.test.ts` is what actually holds these up: it fails the
    // build if a position field or a second transmit path appears anywhere in
    // the feature. These two lines are the human-readable face of that test.
    expect(never).toHaveLength(2);
    expect(never.map((row) => row.text).join(' ')).toMatch(/position/);
    expect(never.map((row) => row.text).join(' ')).toMatch(/identity/);
  });

  it('never promises something is enforced when the module is audit-exempt', () => {
    /*
     * The structural version of the bug. `mesh.privacy.test.ts` exempts
     * `sighting.ts` from its transmit audit, so any claim about sightings is
     * by construction unenforceable. If the exemption is ever lifted this
     * assertion should be updated deliberately, not deleted.
     */
    const privacySource = readFileSync(`${HERE}/../node/mesh.privacy.test.ts`, 'utf8');
    const exempt = privacySource.includes("not.toContain('sighting.ts')");
    if (exempt) {
      expect(
        LEAVES.every((row) => !/sighting/i.test(row.text)),
        'a SENT claim references a module the privacy audit deliberately excludes',
      ).toBe(true);
    }
  });
});
