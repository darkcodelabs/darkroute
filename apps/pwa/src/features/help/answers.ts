/**
 * WHAT THIS APP DOES WITH YOU - the answers, as data.
 *
 * A privacy page is only worth anything if it is checkable. So every answer
 * here names the FILE that makes it true, and the repo is public, so a reader
 * can go and see whether the code agrees with the sentence. An answer that
 * cannot name its enforcement is a promise, and this product's whole argument
 * is that promises about surveillance are worth what you paid for them.
 *
 * RULES FOR EDITING THIS FILE
 *   1. If you change behaviour, change the answer in the same commit.
 *   2. Never write an answer you cannot point at code for. "We take your
 *      privacy seriously" is not an answer.
 *   3. Say the uncomfortable parts. The things this app CANNOT protect are
 *      more useful to a driver than the things it can, because those are the
 *      ones they have to decide about.
 */

export interface HelpAnswer {
  /** The question, as a driver would ask it. */
  readonly question: string;
  /** The answer, in the product's chrome voice: lowercase, blunt, specific. */
  readonly answer: string;
  /** Files a reader can open to check the answer. Repo-relative. */
  readonly checkIn: readonly string[];
}

export interface HelpSection {
  readonly title: string;
  readonly answers: readonly HelpAnswer[];
}

export const HELP_TITLE = 'WHAT THIS APP KNOWS';
export const HELP_STRAPLINE =
  'every answer names the file that makes it true. the repo is public - go and check.';

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: 'YOUR LOCATION',
    answers: [
      {
        question: 'does my location leave this phone?',
        answer:
          'mostly, and here is every exception. distance and bearing are computed on the device. camera data is requested by a tile address covering roughly 15 km, from this app\u2019s own origin. the basemap and speed archive come from tiles.darkroute.ai, a different origin we operate: a speed request identifies roughly a 1.9 km square around the current fix, and basemap range requests reveal the viewport. cloudflare receives those requests with an ip and timestamp; no raw gps coordinate is sent. SHOW ON MAPS hands a camera coordinate to the phone through its local geo: scheme; on iphone the key is hidden because the available fallback would send that coordinate to google over https. that is the whole list.',
        checkIn: [
          'apps/pwa/src/services/cameras/sync.ts',
          'apps/pwa/src/services/cameras/sync.test.ts',
          'apps/pwa/src/features/map/basemap.ts',
          'apps/pwa/src/features/map/speedSource.ts',
          'apps/pwa/src/services/adapters/navigateTo.ts',
        ],
      },
      {
        question: 'do you keep a history of where I have been?',
        answer:
          'on the device, yes - that is what LOG is. it never leaves. nothing uploads it, and REMOVE LOCAL DATA in settings deletes it along with everything else.',
        checkIn: [
          'apps/pwa/src/services/db/repositories/trips.ts',
          'apps/pwa/src/features/settings/removal.ts',
        ],
      },
      {
        question: 'what does the android app do differently?',
        answer:
          'it asks for android’s own location permission so the alert survives the screen locking. a plain web page cannot do that - watchPosition stops when the screen goes off, and no service worker or wake lock changes it. the android build does not send anything the web build does not.',
        checkIn: [
          'apps/pwa/src/services/adapters/twaLocationBridge.ts',
          'apps/android/README.md',
        ],
      },
    ],
  },
  {
    title: 'YOUR PLATE',
    answers: [
      {
        question: 'do you store my licence plate?',
        answer:
          'only if you type one in, and then it is encrypted on the device with a key that never leaves it. a plate is never put in a notification, a url, a log line or an analytics call - the notification payload has no field one could travel through, which is deliberate.',
        checkIn: [
          'apps/pwa/src/services/crypto/plate.ts',
          'apps/pwa/src/services/adapters/notifications.ts',
          'apps/pwa/src/stores/persist.ts',
        ],
      },
      {
        question: 'do you ask flock anything about my plate?',
        answer:
          'no. no flock system is queried by this app, for anything. the only external hand-off opens the bare haveibeenflocked.com homepage and puts your plate on the clipboard - you decide whether to paste it there. this app has no lookup api integration or proxy.',
        checkIn: [
          'apps/pwa/src/features/lookup/handoff.ts',
          'docs/public/AGGREGATION-POLICY.md',
        ],
      },
    ],
  },
  {
    title: 'YOUR SETTINGS',
    answers: [
      {
        question: 'where are my settings saved?',
        answer:
          'in this browser’s own database, on this device. threshold, theme, text size and whether you finished onboarding. nothing is synced, because there is no account and no server to sync to.',
        checkIn: [
          'apps/pwa/src/stores/persistPort.idb.ts',
          'apps/pwa/src/stores/settings.ts',
        ],
      },
      {
        question: 'what stops a plate ending up in there by accident?',
        answer:
          'a guard that runs on every write and refuses anything plate-shaped - a plate-looking string, a plate-shaped key, or a field whose NAME implies plate custody. it refuses on the way in AND on the way back out, because a value that gets read is a value that gets written again.',
        checkIn: ['apps/pwa/src/stores/persist.ts'],
      },
      {
        question: 'can I delete everything?',
        answer:
          'almost. REMOVE LOCAL DATA in settings clears the plate vault, the match index, your trips, your alerts and any photo you attached, and a test asserts they come back empty - a removal that leaves recoverable data is worse than none. it deliberately keeps the reports you signed, because each one commits to the one before it and shredding them would destroy your own evidence; the screen counts what went and what stayed rather than saying everything.',
        checkIn: [
          'apps/pwa/src/features/settings/removal.ts',
          'apps/pwa/src/features/settings/removal.test.ts',
        ],
      },
    ],
  },
  {
    title: 'WHAT WE SEND, AND TO WHOM',
    answers: [
      {
        question: 'is there any analytics, tracking or telemetry?',
        answer:
          'none. the bundle loads no analytics sdk, crash reporter, beacon or third-party script. network traffic still exists: same-origin app and camera files, cross-origin map and speed archives from tiles.darkroute.ai, and chromium\u2019s speech service only if you choose voice input after its warning. those requests are named here instead of being called telemetry.',
        checkIn: [
          'package.json',
          'apps/pwa/vite.config.ts',
          'apps/pwa/src/features/map/basemap.ts',
          'apps/pwa/src/services/adapters/speechRecognition.ts',
        ],
      },
      {
        question: 'is there an account?',
        answer:
          'no. there is nothing to sign into, so there is nothing to link your driving to.',
        checkIn: ['apps/pwa/src/stores/session.ts'],
      },
      {
        question: 'what happens when I file a report?',
        answer:
          'that is the one thing that is meant to leave, and only when you tap SUBMIT. it carries the camera’s position, not your route. it is signed at capture and hash-chained, so it cannot be edited afterwards - including by us. today nothing uploads it: there is no endpoint to send it to, so it is held on this phone.',
        checkIn: [
          'apps/pwa/src/services/crypto/chain.ts',
          'apps/pwa/src/features/report/reportDraft.ts',
          'apps/pwa/src/features/report/reportQueue.ts',
        ],
      },
      {
        question: 'what about the photo I attached?',
        answer:
          'it never leaves either, and it is not the picture your camera saved. the app redraws it and asks the encoder for a new file, so the location tag your camera wrote into it is gone before anything is stored. the report is signed over the photo’s fingerprint, not the photo - which is why REMOVE LOCAL DATA can delete the picture and keep the report you filed.',
        checkIn: [
          'apps/pwa/src/features/report/preparePhoto.ts',
          'apps/pwa/src/features/report/photoDigest.ts',
          'apps/pwa/src/services/db/repositories/reportPhotos.ts',
        ],
      },
    ],
  },
  {
    title: 'WHERE THE CAMERAS COME FROM',
    answers: [
      {
        question: 'who says these cameras are there?',
        answer:
          'openstreetmap contributors. the published camera layer contains OSM nodes that meet this project’s ALPR/ANPR filter, under the open database licence. we did not survey them and we do not vouch for every one - a camera can be moved, removed or mistagged, and the map will be wrong until somebody fixes it there.',
        checkIn: ['scripts/fetch-cameras.mjs', 'docs/public/AGGREGATION-POLICY.md'],
      },
      {
        question: 'so it might miss one?',
        answer:
          'yes. an empty dial means nothing is MAPPED here, not that nothing is watching. that distinction is deliberate everywhere in this app, and it is why the screen never says "clear" when it simply has no data.',
        checkIn: ['apps/pwa/src/features/radar/components/RadarView.tsx'],
      },
    ],
  },
  {
    title: 'WHO ELSE DID THIS WORK',
    answers: [
      {
        question: 'did you invent any of this?',
        answer:
          'nearly all of it, and this page used to say "no", which was the wrong answer to a question about authorship. the app is ours: the alert engine, the distances it warns at, the bands between approaching and near, the report chain, the design, the wording you are reading. 500 feet is a number we chose. the abuse records are ours to have compiled - each one cites a published source you can open, and we picked the counties, wrote the summaries and counted the incidents, which is editorial work and has been wrong once and corrected. what is NOT ours is the camera data. the map is openstreetmap, and the tag scheme that makes it readable - man_made=surveillance plus surveillance:type=ALPR - was settled by DEFLOCK. we read and write that scheme unchanged, because a second vocabulary for the same thing would split the corpus and help nobody. so: built here, on data the commons already had.',
        checkIn: [
          'docs/credits.md',
          'apps/pwa/src/features/report/osmTags.ts',
          'packages/core/src/alert.ts',
          'apps/pwa/public/records/counties.json',
        ],
      },
      {
        question: 'where can I check this for myself?',
        answer:
          'primary sources, not our reading of them. the EFF\u2019s atlas of surveillance maps who deploys what, department by department. police departments publish their own ALPR transparency portals, and a large set of search logs has been recovered by public-records request - that is the one thing this app cannot tell you: whether YOUR plate has already been run. openstreetmap is where the camera data itself lives and where a correction goes. other apps exist in this space and some of them are good; we are not going to rank them for you, because a recommendation is a thing you should reach by reading rather than by being told.',
        checkIn: ['docs/credits.md'],
      },
      {
        question: 'is there a way to find cameras nobody has mapped?',
        answer:
          'yes, and it is not this app. flock finder listens for the wifi the cameras emit when they wake to upload, matches the manufacturer prefix in the mac address against wigle\u2019s wardriving database, and has plotted 40,000+ suspected cameras that way - without anybody having to see one. they publish esp32 detector firmware for live detection too.',
        checkIn: ['docs/credits.md'],
      },
      {
        question: 'what do you refuse to do?',
        answer:
          'anything already done better next door. we do not fork the taxonomy, re-host anyone\u2019s data, audit past searches, or scrape transparency portals. and we do not tell you to obscure a plate: choosing your route is legal in all fifty states, plate flippers and reflective sprays are not.',
        checkIn: ['docs/credits.md'],
      },
    ],
  },
  {
    title: 'HOW TO CHECK ANY OF THIS',
    answers: [
      {
        question: 'why should I believe you?',
        answer:
          'do not. the source is public and every answer above names the file it lives in. the parts that matter most - that no plate reaches a notification, that removal really empties the stores, that a report cannot be published without you placing the camera - are enforced by tests, so you can watch them fail if somebody breaks them. the two places a coordinate DOES leave are named above rather than tested away, because a claim a test cannot make is a claim this app should not print.',
        checkIn: ['README.md'],
      },
    ],
  },
];

/** Every file named above, deduplicated. Used by a test to prove they exist. */
export function citedFiles(): readonly string[] {
  const seen = new Set<string>();
  for (const section of HELP_SECTIONS) {
    for (const answer of section.answers) {
      for (const file of answer.checkIn) seen.add(file);
    }
  }
  return [...seen].sort();
}
