/**
 * PAIRING A NODE READS. IT DOES NOT TRANSMIT.
 *
 * =============================================================================
 * WHY THIS IS A TEST AND NOT A COMMENT
 * =============================================================================
 * The NODE screen tells a driver that what their node hears is read on their
 * device and sent nowhere. That sentence is only true for as long as nobody
 * adds a send, and a send is one line: `connection.sendPacket(...)` inside a
 * button handler would be entirely natural to write and would silently make
 * the screen's own promise false.
 *
 * LoRa is not like a network request. A packet is broadcast in the clear to
 * every radio in range, and on the default channel the key is public. Anything
 * we put on the air is a statement made in a room we cannot see, to people we
 * cannot identify, and it cannot be recalled.
 *
 * =============================================================================
 * WHY THE WHOLE DIRECTORY
 * =============================================================================
 * Guarding one module is not a guard. The connection is created in `mesh.ts`
 * but the screen holds the session, so a send added in `NodeScreen.tsx` would
 * sail past a check that only reads `mesh.ts`. This reads every file in the
 * feature.
 *
 * AND THE FEATURE IS NOW TWO DIRECTORIES. `features/mesh` is v1's surface over
 * the same radio and holds real transmit calls -- so a check scoped to
 * `features/node` had a live transmit path sitting outside it the moment that
 * screen was written. Anything that can reach the session is in scope, wherever
 * it lives.
 *
 * The transmit surface moved once already: `MeshChat.tsx` was replaced by
 * `MeshConversations.tsx`, which sends to a channel OR to one node. The scope
 * assertion below names the current file on purpose, so deleting a screen
 * without moving this check fails loudly rather than silently shrinking what is
 * audited.
 *
 * `sighting.ts` is exempt: it is a pure codec, it holds no connection, and
 * encoding bytes is not transmitting them. The day something calls it, the
 * caller is what this test will catch.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function featureDir(feature: string): string {
  const candidates = [`src/features/${feature}`, `apps/pwa/src/features/${feature}`];
  const found = candidates
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => {
      try {
        return readdirSync(path).length > 0;
      } catch {
        return false;
      }
    });
  expect(found, `could not locate features/${feature}`).toBeDefined();
  return found as string;
}

/** Every directory that can reach the mesh session. */
const GUARDED = ['node', 'mesh'];

/**
 * Every source file in the feature, except the codec and the tests.
 *
 * Tests are excluded because this file necessarily names the very strings it
 * is banning, and so would any test that asserts on them.
 */
function sourceFiles(): { name: string; text: string }[] {
  return GUARDED.flatMap((feature) => {
    const dir = featureDir(feature);
    return readdirSync(dir)
      .filter((n) => (n.endsWith('.ts') || n.endsWith('.tsx')) && !n.includes('.test.'))
      // A pure codec. Encoding bytes is not putting them on the air, and the
      // day something calls it, the CALLER is what this test catches.
      .filter((n) => n !== 'sighting.ts')
      .map((name) => ({ name, text: readFileSync(resolve(dir, name), 'utf8') }));
  });
}

/**
 * Calls that put bytes on the air, or change the node.
 *
 * Not a style rule. Each of these is a different way for this screen to stop
 * being read-only, and the middle group matters as much as the first: writing
 * an owner name or a channel to somebody's node is a change to hardware they
 * own, made by a screen that says it only listens.
 */
/*
 * STILL BANNED, AND EACH FOR ITS OWN REASON.
 *
 * `setOwner` and `setConfig` LEFT this list when the config panels shipped -
 * see `SINGLE_CALL_SITE`. What remains is not "everything we have not needed
 * yet"; it is the set where a single call does damage that cannot be undone
 * from this app:
 *
 *   sendPacket        the raw escape hatch. Anything reachable through it is
 *                     reachable without any of the gates below.
 *   sendWaypoint      puts a COORDINATE on the air. Never.
 *   requestPosition   asks another node for its coordinates. Also never: the
 *                     one thing this project must not do is collect positions.
 *   traceRoute        makes every node on the path log that we asked.
 *   deleteMyNode      wipes the radio's own database.
 *   factoryReset      unrecoverable, and takes the owner's keypair with it.
 *   setModuleConfig   sixteen module panels, none of which a driving app needs,
 *                     and several of which (MQTT, Serial, External Notification)
 *                     can start publishing traffic off the mesh entirely.
 */
const FORBIDDEN_CALLS = [
  'sendPacket',
  'sendWaypoint',
  'setModuleConfig',
  'traceRoute',
  'requestPosition',
  'deleteMyNode',
  'factoryReset',
];

/**
 * `setChannel` MOVED OUT OF THE BAN, AND THE RULE THAT REPLACES IT.
 *
 * =============================================================================
 * WHY IT WAS BANNED, AND WHY THAT IS NO LONGER THE RIGHT LINE
 * =============================================================================
 * The ban said: this screen only listens, so it writes nothing to hardware
 * somebody else owns. That was right while the app had no reason to.
 *
 * Joining a darkroute group is a reason. Group membership in Meshtastic IS a
 * channel - a name and a pre-shared key - and there is no other mechanism.
 * Refusing the call meant refusing the feature.
 *
 * THE PROMISE DID NOT GET WEAKER, IT GOT MORE PRECISE. The screen still
 * listens by default and joins nothing on its own. What changed is that a
 * person can press JOIN, and the ban is replaced by the same one-file rule
 * `sendText` has lived under since mesh chat shipped: exactly one call site,
 * in `mesh.ts`, reviewable in one place.
 *
 * Two properties keep this honest, both verified in firmware source:
 *   - A SECONDARY channel ignores radio settings and uses only its PSK
 *     (channel.proto, Channel.Role). The primary channel, the frequency, the
 *     region and the modem preset are untouched.
 *   - Writing one transmits NOTHING. The admin packet is addressed to the
 *     local node, and `Router::sendLocal` short-circuits before the radio.
 *
 * `setOwner`, `setConfig`, `setModuleConfig` and `factoryReset` stay dead.
 * Those rename somebody's node or rewrite their radio, and no feature here
 * needs them.
 */
/*
 * WRITES THAT ARE ALLOWED, EACH FROM EXACTLY ONE PLACE.
 *
 * The rule is not "these are safe", it is "these have one call site, and that
 * call site is a person pressing a button". A second caller is what turns a
 * deliberate write into something a timer or a retry can do on its own, which
 * is the failure mode this whole file exists to prevent.
 *
 *   sendText     a message, from the composer
 *   setChannel   join or leave a channel, from the channels panel
 *   setOwner     the node's own name, from the user panel
 *   setConfig    LoRa region/preset/hops and the security flags, from their
 *                panels. This is the owner's radio and refusing to let them
 *                name it or set its region made the app less useful without
 *                making anybody safer - they simply used another app to do it.
 */
const SINGLE_CALL_SITE = [
  'connection.sendText(',
  'connection.setChannel(',
  'connection.setOwner(',
  'connection.setConfig(',
];

/**
 * Location fields. The node knows where the phone is if we ever tell it, and
 * a position packet is the one thing this project must never emit.
 */
const FORBIDDEN_LOCATION = ['latitudeI', 'longitudeI', 'onPositionPacket', 'onWaypointPacket'];

describe('the node feature never transmits', () => {
  it('reads at least the modules it is supposed to be guarding', () => {
    // A path or filter mistake would make every assertion below vacuous.
    const names = sourceFiles().map((f) => f.name);
    expect(names).toContain('mesh.ts');
    // v1's conversation surface, which holds `sendText` AND `sendDirect`.
    expect(names).toContain('MeshConversations.tsx');
    // And the screens it replaced must be GONE, not merely unrendered: dead
    // code holding a live transmit path is the worst of both. `NodeScreen.tsx`
    // was v0's session surface and went with v0 itself.
    expect(names).not.toContain('MeshChat.tsx');
    expect(names).not.toContain('NodeScreen.tsx');
    expect(names).toContain('instrument.ts');
    expect(names).toContain('chat.ts');
    expect(names).not.toContain('sighting.ts');
  });

  it.each(FORBIDDEN_CALLS)('never calls %s', (call) => {
    for (const file of sourceFiles()) {
      expect(
        file.text,
        `${file.name} calls ${call}. The NODE screen promises it only listens.`,
      ).not.toContain(`${call}(`);
    }
  });

  it.each(FORBIDDEN_LOCATION)('never touches %s', (token) => {
    for (const file of sourceFiles()) {
      expect(
        file.text,
        `${file.name} references ${token}. A driver's position must never reach the radio.`,
      ).not.toContain(token);
    }
  });

  it.each(SINGLE_CALL_SITE)('keeps %s to exactly one file', (call) => {
    // A second call site is how a screen that acts only when somebody presses
    // a button turns into one that acts on a timer, and nobody reviews the
    // diff that does it. One file, so the whole behaviour is one review.
    const callers = sourceFiles().filter((f) => f.text.includes(call));
    expect(callers.map((f) => f.name)).toStrictEqual(['mesh.ts']);
  });

  it('joins nothing on its own - every channel write needs a press', () => {
    /*
     * The listen-only promise, in the form that survives the join feature.
     * `setChannel` may exist, but never on a timer, never on connect, and
     * never inside a subscription handler. It is reachable only from a
     * function the UI calls, and that function is exported for a button.
     */
    const mesh = sourceFiles().find((f) => f.name === 'mesh.ts');
    expect(mesh).toBeDefined();
    const text = mesh?.text ?? '';
    const at = text.indexOf('connection.setChannel(');
    expect(at, 'no setChannel call to check').toBeGreaterThan(-1);
    // The 600 characters before the call must not be a timer or a subscribe.
    const before = text.slice(Math.max(0, at - 600), at);
    for (const automatic of ['setInterval(', 'setTimeout(', '.subscribe(']) {
      expect(before, `setChannel sits inside ${automatic}`).not.toContain(automatic);
    }
  });

  it('sends only what the gate has passed', () => {
    // The surface that holds the session must not call its send without asking
    // `refuseToSend` first. That check is what keeps a plate off the air. v0's
    // `NodeScreen.tsx` held it; v1's `MeshConversations.tsx` does, and it is
    // the only file in either feature that reaches `sendText`.
    const screen = sourceFiles().find((f) => f.name === 'MeshConversations.tsx');
    expect(screen).toBeDefined();
    if (screen?.text.includes('.sendText(') === true) {
      expect(screen.text, 'MeshConversations sends without consulting refuseToSend').toContain(
        'refuseToSend',
      );
    }
  });

  it('never broadcasts on a timer', () => {
    // Every transmission is a person deciding to transmit. A send reachable
    // from a timer is not that, however it is written.
    for (const file of sourceFiles()) {
      const timed = /set(Interval|Timeout)\([^)]*send/s.test(file.text);
      expect(timed, `${file.name} appears to send from a timer`).toBe(false);
    }
  });
});
