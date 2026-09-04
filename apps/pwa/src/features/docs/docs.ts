/**
 * THE DOCUMENTATION INDEX, as data.
 *
 * =============================================================================
 * WHY THE APP SHIPS A DOCS SCREEN AT ALL
 * =============================================================================
 * Most apps do not need one. This app tells people where surveillance cameras
 * are, and asks them to trust a set of privacy claims they cannot see from the
 * outside: that coordinates stay on the phone, that there is no account, that
 * removal really empties the stores.
 *
 * A claim a user cannot check is a claim they have to take on faith, which is
 * exactly the posture this product exists to argue against. So the app carries
 * a route to the documents and, more importantly, to the COMMIT IT IS RUNNING -
 * without which "the source is public" is an unfalsifiable statement, because
 * nobody can tell whether the source they read built the bundle they are using.
 *
 * =============================================================================
 * LINKS OUT, DELIBERATELY
 * =============================================================================
 * The documents live in the repository, not in the bundle. Two reasons, and
 * neither is laziness:
 *
 *   1. Embedding them would put a stale copy on the phone. Documentation that
 *      disagrees with the code is worse than documentation somebody has to
 *      fetch, and an offline-first app caches aggressively enough that the copy
 *      WOULD go stale.
 *   2. The point is that they are auditable IN CONTEXT, beside the code and
 *      tests that make each current claim checkable. The public history starts
 *      at the squashed release root; it does not expose private development
 *      commits from before publication.
 *
 * What ships on the device is this index and the build stamp: enough to know
 * what exists, and enough to check that the thing running matches the thing
 * published.
 */

import { BUILD } from '../../app/buildInfo.ts';

export const DOCS_TITLE = 'How this works';

export const DOCS_LEDE =
  'this app asks you to believe several things about what it does with your location. none of them are checkable from inside an app, so all of it is written down beside the code, and the build you are running is stamped below so you can tell the two match.';

/** The repository the documents live in. Public at release, from a squashed root. */
export const REPO_URL = 'https://github.com/darkcodelabs/darkroute';

/**
 * IS THAT REPOSITORY ACTUALLY REACHABLE YET?
 *
 * It is, since 2026-09-03. Every link on this screen resolves.
 *
 * This was `false` for one build after the repository opened, and the screen
 * went on telling readers that the links they could already follow would 404 -
 * on the one screen whose entire argument is that our claims are checkable.
 * That is a worse failure than the 404 it was written to prevent: a broken link
 * is a mistake, and telling somebody a working link is broken is being wrong
 * about your own product in public.
 *
 * FLIPPING THIS IS HALF A JOB. `scripts/check-public-links.mjs` reads this
 * constant and cross-checks it against what the URLs actually do, so setting it
 * `true` while the repository is still private fails the gate, and leaving it
 * `false` after the repository opens fails it too. Neither half can ship alone -
 * which is exactly the check that should have caught this the moment the
 * repository went public, and does now.
 */
export const REPO_PUBLIC = true;

/*
 * Kept, unused while `REPO_PUBLIC` is true, and deliberately not deleted: the
 * pair is the mechanism. If the repository ever goes dark again this is what
 * the screen owes a reader, and rewriting it from scratch under time pressure
 * is how a screen ends up quietly handing out dead links instead.
 */
export const REPO_PRIVATE_NOTE =
  'these documents are not reachable right now - every link below lands on a github 404. it is said here rather than left for you to discover, because a screen about checking our claims should not be the one thing you cannot check.';

/** Where a document lives, relative to the repository root. */
const DOCS_PATH = 'blob/main/docs/public';

export interface DocEntry {
  readonly file: string;
  readonly title: string;
  /** What it answers, in the voice of the person who would ask. */
  readonly sub: string;
  /** True for the two a sceptical reader should open first. */
  readonly start?: boolean;
}

/**
 * The set, in the order a stranger should read it.
 *
 * AUDITING comes first on purpose. Somebody who does not trust this project
 * does not want an architecture tour, they want the commands that let them
 * check. Giving them the tour first reads as a sales pitch.
 */
export const DOC_ENTRIES: readonly DocEntry[] = [
  {
    file: 'AUDITING.md',
    title: 'Check it yourself',
    sub: 'the commands that prove the privacy claims, for somebody who does not trust us',
    start: true,
  },
  {
    file: 'THREAT-MODEL.md',
    title: 'What this does and does not protect you from',
    sub: 'including the parts where the honest answer is "it does not"',
    start: true,
  },
  {
    file: 'ARCHITECTURE.md',
    title: 'How it works',
    sub: 'the flows, as diagrams, including everything that leaves the device',
  },
  {
    file: 'API.md',
    title: 'API reference',
    sub: 'every endpoint, every request this app makes, and what it caches',
  },
  {
    file: 'DATA-CONTRACTS.md',
    title: 'Data contracts',
    sub: 'the signed record, the canonical bytes, and the Meshtastic protobufs',
  },
  {
    file: 'DATA-PROVENANCE.md',
    title: 'Where the camera data comes from',
    sub: 'OpenStreetMap, the exact query, the licence, and how to rebuild it',
  },
  {
    file: 'TAXONOMY.md',
    title: 'Taxonomy and exports',
    sub: 'what we call things, and how to turn this data into yours',
  },
  {
    file: 'TRANSPARENCY.md',
    title: 'Transparency',
    sub: 'what gets published if somebody sends a legal demand',
  },
  {
    file: 'SECURITY.md',
    title: 'Reporting a vulnerability',
    sub: 'including privacy leaks, which count here',
  },
  {
    file: 'LEGAL.md',
    title: 'The legal position',
    sub: 'what is settled, what is not, and what we will not do',
  },
];

export function docUrl(file: string): string {
  return `${REPO_URL}/${DOCS_PATH}/${file}`;
}

/**
 * The exact commit this bundle was built from.
 *
 * THE ONE FACT THAT MAKES THE REST FALSIFIABLE. "The source is public" is not
 * a checkable claim on its own - the reader has no way to know the published
 * source built the bundle they are running. With the commit they can diff.
 */
export function commitUrl(): string | null {
  // THE SHA, NOT THE DESCRIBE STRING. `BUILD.commit` is
  // `git describe --always --dirty`, which renders as `v0-design-83-g<short-sha>`
  // once any tag exists - readable, and not a ref GitHub can resolve. Built
  // from it, this link 404s even with the repository public, which would have
  // broken the one promise this screen exists to keep.
  if (BUILD.commitSha === 'dev' || BUILD.commitSha === 'nogit') return null;
  return `${REPO_URL}/commit/${BUILD.commitSha}`;
}

export const COMMIT_NOTE =
  'the commit this build came from. open it to read the exact source that produced what is on your phone.';

export const COMMIT_DEV_NOTE =
  'this is a development build, so it has no published commit to point at. a release build stamps one here.';


// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/**
 * TAKING THE DATA SOMEWHERE THIS APP CANNOT GO.
 *
 * The app warns a driver holding a phone. Plenty of the time the phone is in a
 * pocket and the thing on the dash is a satnav, so the archive is more useful
 * as a file than as a screen.
 *
 * Everything here is generated ON THE DEVICE from the archive already synced -
 * see `poiExport.ts` for why that beats a hosted download. Nothing is fetched,
 * nothing is uploaded, and a driver who is offline can still produce the file.
 */
export const INTEGRATIONS_TITLE = 'Integrations';

export const INTEGRATIONS_LEDE =
  'the camera archive, as a file other devices understand. built on this phone from the data already synced, so it is exactly as current as the warnings you have been getting. nothing is uploaded and nothing is fetched.';

export const POI_TITLE = 'Satnav and GPS units';

export const POI_BODY =
  'a satnav that takes custom points will give you an audible warning as you approach one, standalone - no phone, no account, no subscription. load the file with the maker\u2019s own POI tool.';

/**
 * THE THING A DRIVER WOULD OTHERWISE TRY FIRST, AND WHY IT CANNOT WORK.
 *
 * Radar detectors are the obvious device for this and they are the wrong one.
 * Standalone, a detector alerts on radio it hears plus a camera database its
 * maker controls and nobody else can write to. Its GPS "mute points" exist to
 * SILENCE a known false alert - the exact inverse of the job. Loading cameras
 * there would mark tens of thousands of places the unit is quieter than usual.
 *
 * Said here so somebody does not spend a weekend finding out.
 */
export const POI_DETECTOR_NOTE =
  'a radar detector will not take these. it alerts on radio it hears, and its gps points are for muting false alerts rather than raising real ones - loading cameras into it would make it quieter, not louder.';

export const POI_STALE_NOTE =
  'the file is a snapshot. cameras get added and removed, so it goes out of date while the app does not - come back and build a fresh one every few months.';
