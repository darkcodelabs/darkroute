/**
 * MESH - one screen, not three.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section C, frame 5.
 *
 * =============================================================================
 * CHAT AND CONFIG DO NOT EXIST WHILE UNPAIRED
 * =============================================================================
 * Brief 4: "Chat and Config are empty screens today. They do not exist while
 * unpaired - they are a locked line inside Radios instead of two 700 px voids."
 *
 * Both were reachable, both mounted, and with no node paired both drew a title
 * and nothing under it. A tab that opens onto nothing is worse than a tab that
 * says why it is closed: the first reads as a broken app, the second reads as
 * an app waiting for hardware. So the segmented control still draws all three
 * keys - the shape of the screen does not change when a radio is plugged in,
 * which is what makes the lock legible - and two of them are `disabled` and in
 * the faint tier until `mesh.status` is `connected`. The pairing card carries
 * the sentence that explains it.
 *
 * They are not merely hidden behind a style: a `disabled` button announces as
 * unavailable, and `active` below cannot resolve to a locked tab even if
 * something set the state to one.
 *
 * =============================================================================
 * ONE PROMO CARD THAT MAKES THE CLAIM AND QUALIFIES IT
 * =============================================================================
 * "One promo card carries the claim AND qualifies it: headline, one paragraph,
 * then three hairline-separated rules inside the same card... Do not make these
 * three separate cards - a claim followed by three unexplained pills is what
 * this replaced."
 *
 * That was the shape here: a lavender slab making the argument, and beneath it
 * a separate bordered list of three pills. Read in order, the pills arrived
 * after the card had finished, so they read as decoration rather than as the
 * fine print on the claim directly above them. Inside one card, hairline-
 * separated, with the tags stacked in a 52px right-aligned column, they read as
 * what they are: the terms of the sentence at the top.
 *
 * PURPLE LEAVES MESH. The slab was `--fwm-accent-mesh` (#8A6BFF), which spent
 * the one hue in the palette with no job on decoration. Brief 4 gives purple a
 * job - unverified - and takes it back from here. See `--dr-owner-unverified`
 * in tokens.css and the owner decision written beside it.
 *
 * =============================================================================
 * WHAT LEAVES YOUR CAR IS STILL ENFORCED BY A TEST, NOT BY INTENTION
 * =============================================================================
 * `LEAVES` keeps its name, its export and its `{ state, text }` shape because
 * `leaves.test.ts` imports it from this file and holds the promise up: a SENT
 * line must name a capability the session actually exposes, and the number of
 * SENT lines must equal the number of transmit methods the mesh session has.
 * `mesh.privacy.test.ts` reads this whole feature and fails on any transmit
 * path other than the deliberate one. Both still pass, and they pass for the
 * same reason they did before rather than because they were relaxed.
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { subscribeMesh } from '../node/mesh.ts';
import type { MeshState } from '../node/mesh.ts';
import { MeshConfig } from './MeshConfig.tsx';
import { MeshConversations } from './MeshConversations.tsx';
import { MeshRadios } from './MeshRadios.tsx';
import { ReloadTitle } from '../../components/nav';

import '../../styles/screen.css';
import './mesh.css';

export const MESH_TITLE = 'Mesh';
export const TAB_RADIOS = 'Radios';
export const TAB_CHAT = 'Chat';
export const TAB_CONFIG = 'Config';

export const MESH_PITCH_TITLE = 'Warn the drivers near you without telling anyone who you are.';
export const MESH_PITCH_BODY =
  'A small LoRa radio in your car carries short typed messages to cars a few miles out. ' +
  'No SIM, no account, no server.';

/**
 * WHAT LEAVES YOUR CAR.
 *
 * Written as claims because that is what they are, and every one is enforced
 * by a test rather than by intention. `sent` is what the product transmits;
 * `never` is what it will not, and `mesh.privacy.test.ts` fails the build if
 * a second transmit path or any position field appears in this feature.
 *
 * ONE CLAIM WAS DELETED FROM THIS LIST, AND THE REASON MATTERS MORE THAN THE
 * CLAIM. It read "camera pins you choose to share", and it was false: the
 * encoder for that (`node/sighting.ts`) has never had a production caller -
 * its only importers are its own test and the privacy test that EXCLUDES it
 * (`mesh.privacy.test.ts` asserts `not.toContain('sighting.ts')`). So the
 * paragraph three lines above, promising every claim here is test-enforced,
 * was sitting directly over a claim no test could enforce because the feature
 * did not exist.
 *
 * That is the worst shape a defect can take in this product. Nothing else in
 * the app is worth anything if this list is aspirational, so the rule is now
 * explicit: a line goes in LEAVES when the transmit path is wired and a test
 * covers it, never when it is planned.
 *
 * THE CASING IS THE SPEC'S. The claims themselves are unchanged - one sent,
 * two never, the same three facts - and the shape is unchanged, which is what
 * `leaves.test.ts` reads. What changed is that they are now set as sentences
 * inside a card rather than as labels beside pills, and lower-case fine print
 * under an upper-case tag reads as a footnote to it.
 */
export const LEAVES = [
  { state: 'SENT', text: 'Short typed messages. No attachments, no voice.' },
  { state: 'NEVER', text: 'Your position, speed, route, or time on the mesh.' },
  { state: 'NEVER', text: 'A stable identity. Nothing ties two messages together.' },
] as const;

type MeshTab = 'radios' | 'chat' | 'config';

export function MeshScreen(): ReactElement {
  /**
   * CHAT FIRST, ONCE THERE IS A CHAT.
   *
   * RADIOS is the explainer - what a LoRa radio is, what leaves your car, how
   * to pair one. It is a thing you read ONCE. CHAT is what the screen is for
   * every time after that, and opening on the manual makes everybody re-enter
   * the tutorial to reach the room. So the preference stays `chat`, and
   * `active` below is what the driver actually gets: while nothing is paired
   * there is no room to open, and RADIOS is the only screen that exists.
   */
  const [tab, setTab] = useState<MeshTab>('chat');
  const [mesh, setMesh] = useState<MeshState | null>(null);

  useEffect(() => subscribeMesh(setMesh), []);

  /** The one flag that decides whether Chat and Config exist at all. */
  const connected = mesh?.status === 'connected';
  const active: MeshTab = connected ? tab : 'radios';

  const tabs: readonly { key: MeshTab; label: string; locked: boolean }[] = [
    { key: 'radios', label: TAB_RADIOS, locked: false },
    { key: 'chat', label: TAB_CHAT, locked: !connected },
    { key: 'config', label: TAB_CONFIG, locked: !connected },
  ];

  return (
    <section className="fwm-screen fwm-mesh" data-fwm-tab={active} aria-label="mesh">
      {/* No back key: MESH is a dock root. See `MoreScreen.tsx`. */}
      <div className="fwm-screen-title">
        <ReloadTitle title={MESH_TITLE} className="fwm-screen-title-text" />
      </div>

      <div className="fwm-screen-band fwm-mesh-band">
        <div className="fwm-screen-seg fwm-mesh-tabs" role="tablist" aria-label="mesh">
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active === entry.key}
              disabled={entry.locked}
              className="fwm-screen-seg-key"
              data-fwm-selected={String(active === entry.key)}
              data-fwm-locked={String(entry.locked)}
              onClick={() => {
                setTab(entry.key);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {active === 'config' ? (
          /* CONFIG.
           *
           * The RADIOS tab could already tell somebody their region was wrong,
           * their preset did not match, or their node had no name - and then
           * offered no way to change any of it. A screen that diagnoses and
           * cannot treat sends people to another app, which is the opposite of
           * one pane of glass. Four panels, not Meshtastic's twenty-five: see
           * the file header for what is deliberately absent and why. */
          <MeshConfig />
        ) : active === 'radios' ? (
          <>
            {/* THE PROMO CARD. The claim, the explanation, and the three rules
                that qualify it - all one object, because they are one argument.
                See the file header for what this replaced. */}
            <div className="fwm-screen-card fwm-mesh-pitch">
              <h2 className="fwm-mesh-pitch-title">{MESH_PITCH_TITLE}</h2>
              <p className="fwm-mesh-pitch-body">{MESH_PITCH_BODY}</p>

              <ul className="fwm-mesh-leaves" aria-label="what leaves your car">
                {LEAVES.map((rule) => (
                  <li className="fwm-mesh-leaf" key={rule.text}>
                    {/* THE TAG COLUMN IS 52 WIDE AND RIGHT-ALIGNED, so SENT,
                        NEVER and NEVER stack into a spine down the left of the
                        rules rather than each one starting where its own word
                        happens to end. */}
                    <span className="fwm-mesh-leaf-state fwm-data" data-fwm-state={rule.state}>
                      {rule.state}
                    </span>
                    <span className="fwm-mesh-leaf-text">{rule.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* RADIOS. The pairing card is its first card and stays there: it
                owns `canMesh()`, the in-flight flag and the connect call, and
                lifting the markup up here would leave the state behind it. */}
            <MeshRadios />
          </>
        ) : (
          /* CHAT IS A THREAD.
           *
           * This rendered the whole of `<NodeScreen />` - installer, pairing,
           * instrument, four accordions, and a text field somewhere under all
           * of it. The justification was keeping one transcript rather than
           * two, and the concern was right: the answer was to move the
           * transcript out to `node/transcript.ts`, where both surfaces read
           * the same one, rather than to render a whole screen twice. */
          <MeshConversations />
        )}
      </div>

      <div className="fwm-screen-dock-reserve" aria-hidden="true" />
    </section>
  );
}
