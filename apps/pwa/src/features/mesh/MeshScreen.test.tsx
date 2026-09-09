/**
 * MESH IS ONE SCREEN WHILE UNPAIRED, AND THE PROMISE IS ONE CARD.
 *
 * =============================================================================
 * TWO DEFECTS, AND THEY ARE THE SAME DEFECT
 * =============================================================================
 * CHAT AND CONFIG WERE TWO EMPTY SCREENS. Both tabs were reachable with no node
 * paired, both mounted, and both drew a heading over nothing. A tab that opens
 * onto 700px of nothing reads as a broken app; a tab that says why it is closed
 * reads as an app waiting for hardware. Brief 4: "they do not exist while
 * unpaired - they are a locked line inside Radios".
 *
 * THE GUARANTEES WERE THREE UNEXPLAINED PILLS. A lavender slab made the claim,
 * and a separate bordered list underneath carried SENT / NEVER / NEVER. Read in
 * order the pills arrived after the argument had finished, so they read as
 * decoration rather than as the fine print on the sentence above them.
 *
 * Both are a promise separated from its qualification. The tests below hold the
 * two structural facts that fix them, because both are the kind of thing a
 * later refactor undoes without noticing: a tab is easy to un-disable, and a
 * card is easy to split.
 *
 * WHAT IS NOT HERE. The CONTENT of `LEAVES` is `leaves.test.ts`'s, and the
 * transmit audit behind it is `features/node/mesh.privacy.test.ts`'s. This file
 * asserts only where those three claims are DRAWN. Duplicating the claim
 * assertions here would give two files an opinion about one promise, which is
 * how one of them ends up relaxed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type * as MeshModule from '../node/mesh.ts';

import { LEAVES, MESH_PITCH_TITLE, MeshScreen, TAB_CHAT, TAB_CONFIG, TAB_RADIOS } from './MeshScreen.tsx';
import { RADIOS_LOCKED_NOTE, RADIOS_NONE, RADIOS_PAIR } from './MeshRadios.tsx';

/** This file's own directory, so the stylesheet check is cwd-independent. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/*
 * NO RADIO, WHICH IS THE STATE THE SPEC DRAWS.
 *
 * `subscribeMesh` is stubbed to a subscription that never publishes, so
 * `mesh` stays null and `connected` is false - the same thing a phone with no
 * Web Bluetooth and no node reports. `canMesh` is stubbed false for the same
 * reason: jsdom has no `navigator.bluetooth`, and letting the real one run
 * would make the pairing key's disabled state depend on the test environment
 * rather than on the fixture.
 */
vi.mock('../node/mesh.ts', async () => {
  const actual = await vi.importActual<typeof MeshModule>('../node/mesh.ts');
  return {
    ...actual,
    canMesh: () => false,
    subscribeMesh: () => () => undefined,
    liveSession: () => null,
  };
});

function tab(name: string): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'mesh' })).getByRole('tab', { name });
}

describe('MESH while nothing is paired', () => {
  it('still draws all three keys, because the shape must not change on pairing', () => {
    render(<MeshScreen />);

    // Hiding them would make the screen rearrange itself the moment a radio is
    // plugged in, and would leave nowhere to say what the other two are.
    expect(tab(TAB_RADIOS)).toBeInTheDocument();
    expect(tab(TAB_CHAT)).toBeInTheDocument();
    expect(tab(TAB_CONFIG)).toBeInTheDocument();
  });

  it('locks Chat and Config rather than opening them onto nothing', () => {
    render(<MeshScreen />);

    // `disabled`, not merely quiet: a screen reader has to hear that these are
    // unavailable, and a pointer must not be able to reach the void behind them.
    expect(tab(TAB_CHAT)).toBeDisabled();
    expect(tab(TAB_CONFIG)).toBeDisabled();
    expect(tab(TAB_RADIOS)).toBeEnabled();
    expect(tab(TAB_RADIOS)).toHaveAttribute('aria-selected', 'true');
  });

  it('says where Chat and Config went, on the card whose button unlocks them', () => {
    render(<MeshScreen />);

    expect(screen.getByText(RADIOS_LOCKED_NOTE)).toBeInTheDocument();
  });

  it('opens on Radios however the tab preference was left', () => {
    /*
     * The component prefers CHAT - it is what the screen is for once there is a
     * room to open, and opening on the manual makes everybody re-enter the
     * tutorial. With nothing paired there is no room, so the preference cannot
     * resolve to it. This is the assertion that the lock is on the RESOLVED tab
     * and not only on the button.
     */
    render(<MeshScreen />);

    expect(screen.getByText(MESH_PITCH_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RADIOS_NONE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RADIOS_PAIR })).toBeInTheDocument();
  });
});

describe('the promise is one card', () => {
  it('puts all three rules inside the card that makes the claim', () => {
    render(<MeshScreen />);

    const rules = screen.getByRole('list', { name: 'what leaves your car' });
    const card = rules.closest('.fwm-screen-card');

    // The card the rules are in is the card the headline is in. Split them and
    // this fails, which is the direction the failure should point.
    expect(card).not.toBeNull();
    expect(card && within(card as HTMLElement).getByText(MESH_PITCH_TITLE)).toBeInTheDocument();
    expect(within(rules).getAllByRole('listitem')).toHaveLength(LEAVES.length);
  });

  it('draws the tags as a spine rather than as three separate cards', () => {
    render(<MeshScreen />);

    const rules = screen.getByRole('list', { name: 'what leaves your car' });
    const tags = [...rules.querySelectorAll('.fwm-mesh-leaf-state')].map(
      (node) => node.textContent ?? '',
    );

    expect(tags).toEqual(LEAVES.map((rule) => rule.state));
    // One card on the screen holds the claim; the pairing card is the other.
    // Three more would be the shape brief 4 replaced.
    expect(document.querySelectorAll('.fwm-screen-card')).toHaveLength(1);
  });

  it('spends no purple, because purple means unverified now', () => {
    /*
     * The lavender slab was `--fwm-accent-mesh` (#8A6BFF), the one hue in the
     * palette with no meaning. Brief 4 gives purple a job - an unverified
     * camera - and takes it back from here. A decorative slab in nearly that
     * hue on another screen is how a taxonomy stops being readable.
     *
     * ASSERTED AGAINST THE STYLESHEET, not against a render. jsdom applies no
     * stylesheet, so a DOM check here would pass whatever the CSS said, which
     * is the shape of test this codebase warns about by name: it would be
     * vacuously true and would go on being true after somebody put the slab
     * back. `--fwm-accent-mesh` is still a real token used elsewhere; what
     * must not happen is this screen reading it again.
     */
    // COMMENTS STRIPPED, because the file's own header explains at length that
    // the slab was deleted and names the token while doing it. A check that
    // could not tell an explanation from a declaration would forbid writing the
    // explanation down, which is the wrong thing to enforce.
    const css = readFileSync(resolve(HERE, 'mesh.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );

    // The parser is checked before what it parses, so a bad path cannot make
    // the assertion below pass by finding nothing.
    expect(css).toContain('.fwm-mesh-pitch-title');
    expect(css).not.toContain('--fwm-accent-mesh');
  });
});
