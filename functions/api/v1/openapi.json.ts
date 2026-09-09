/**
 * THE MACHINE-READABLE CONTRACT.
 *
 * =============================================================================
 * WHY IT IS HAND-WRITTEN AND NOT GENERATED
 * =============================================================================
 * A generated document describes the SHAPE of a response. The things callers
 * actually get wrong about this API are not shapes - they are the CAPS and the
 * meaning of an empty answer, neither of which a type annotation can carry.
 *
 * So the descriptions here are the real documentation: why a box is limited to
 * 1.5 degrees, what a 429 means and what to do instead, and the fact that no
 * cameras returned is a statement about the MAP rather than about the road. A
 * caller who reads only this file should still come away unable to
 * misunderstand the last one.
 *
 * =============================================================================
 * WHY IT IS NEVERTHELESS CHECKED AGAINST THE CODE
 * =============================================================================
 * Hand-written meant it drifted. This document said "no write path" for weeks
 * after `/submit` and `/photo` shipped, listed six paths of the nine that were
 * served, and enumerated the error codes of one endpoint under a component
 * every endpoint referenced. Nobody noticed because nothing compared it to
 * anything.
 *
 * Now two things hold it to the code. Every number and list quoted below is
 * IMPORTED from the handler that enforces it - the span cap, the tile cap, the
 * owner types, the media types, the document names - so a changed cap changes
 * this document in the same commit. And `openapi.json.test.ts` reads the route
 * table in `_routes.ts` and every handler's source, and fails when a path or
 * an error code exists in one place and not the other.
 *
 * Served as a Function rather than a static asset so it is under the same rate
 * limit and CORS policy as everything else it describes, and so the server URL
 * can be the origin actually being called rather than one hard-coded here.
 */

import { json } from './_middleware.ts';
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_SPAN_DEG, MAX_TILES, OWNER_TYPES } from './cameras.ts';
import { DOCS } from './doc/[name].ts';
import { MAX_QUERY, MAX_RESULTS } from './place.ts';
import { MAX_BYTES, TYPES as PHOTO_TYPES } from './photo/[[key]].ts';
import { MAX_EXCLUSIONS, MAX_SPAN_DEG as MAX_ROUTE_SPAN_DEG } from './route.ts';
import { FIELDS, KINDS, MAX_PER_HOUR } from './submit.ts';

interface Env {
  readonly CAMERA_TILES?: R2Bucket;
}

/**
 * WHERE THE API ANSWERS.
 *
 * `darkroute.ai/api/v1` is canonical - the handlers run there, next to the
 * camera route they read through. `api.darkroute.ai` is a separate Pages
 * project (the developer console) whose Functions proxy `/api/v1/*` and the
 * shorter `/v1/*` to the canonical origin, forwarding the caller's address so
 * the rate limit buckets the real client. Both hosts are listed only when the
 * document is being served from the canonical origin; a preview or local build
 * names itself alone, because listing a host it is not is how a spec lies.
 */
const CANONICAL = 'https://darkroute.ai';
const ALIAS = 'https://api.darkroute.ai';

const OWNER_TYPE_LIST = [...OWNER_TYPES];
const PHOTO_MEDIA_TYPES = Object.keys(PHOTO_TYPES);
const PHOTO_KEY_PATTERN = '^[0-9a-f]{32}\\.(jpg|png|webp)$';
const PHOTO_MAX_MB = MAX_BYTES / 1024 / 1024;

/** A JSON error body: the same two fields on every refusal this API makes. */
function errorBody(codes: readonly string[]): Record<string, unknown> {
  return {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error', 'detail'],
        properties: {
          error: { type: 'string', enum: [...codes] },
          detail: { type: 'string', description: 'A sentence for a person. Show it; do not parse it.' },
        },
      },
    },
  };
}

function refusal(description: string, codes: readonly string[]): Record<string, unknown> {
  return { description, content: errorBody(codes) };
}

const RATE_LIMITED = { $ref: '#/components/responses/RateLimited' };

export const onRequestGet: PagesFunction<Env> = (context) => {
  const url = new URL(context.request.url);

  const servers =
    url.origin === CANONICAL
      ? [
          { url: CANONICAL, description: 'Canonical. The handlers run here.' },
          {
            url: ALIAS,
            description:
              'The developer console host. Its Functions proxy every path below to the canonical ' +
              'origin unchanged, and also serve them without the `/api` prefix as `/v1/*`. Responses ' +
              'carry `x-darkroute-upstream` saying where the answer came from.',
          },
        ]
      : [{ url: url.origin }];

  return json(200, {
    openapi: '3.1.0',
    info: {
      title: 'DarkRoute public API',
      version: '1.1.0',
      summary: 'Read access to the published ALPR camera archive, and a reviewed way to correct it.',
      description:
        'No key and no account. The archive is OpenStreetMap data under ODbL and every response ' +
        'repeats the attribution, because the obligation travels with the data.\n\n' +
        'READS are GET. The archive itself is never written through this API: the two non-GET routes ' +
        'open a public pull request (`POST /api/v1/submit`) and store a photograph that a pull request ' +
        'refers to (`PUT /api/v1/photo`). Nothing either of them does changes the published data ' +
        'until a person merges it.\n\n' +
        'IMPORTANT: an empty result means no camera is MAPPED in that area. It is never evidence ' +
        'that no camera is present. Coverage is dense in metropolitan areas and thin in rural ' +
        'ones, and mobile units move.\n\n' +
        'For bulk work, take the published dataset rather than paging these endpoints. The ' +
        'per-request caps exist so that bulk access happens the cheap way, not so that it cannot ' +
        'happen.\n\n' +
        'CONVENTIONS. Every error is JSON with `error` (a stable code, enumerated per response below) ' +
        'and `detail` (a sentence). Unknown paths under `/api/v1/` are `404 not_found` listing what ' +
        'exists; a known path asked with a method it does not take is `405 method_not_allowed` with an ' +
        '`allow` header. HEAD is answered for every GET with the same headers and no body. CORS is ' +
        '`access-control-allow-origin: *` with no credentials. Every request from one address counts ' +
        'against a budget of 60 per minute (`ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` ' +
        'on every response; `429` with `retry-after` when spent) - a per-isolate speed bump, not a ' +
        'guarantee, and not the only limiter. Successful reads are `cache-control: public` for five ' +
        'minutes unless a path says otherwise; a route is never cached.',
      license: { name: 'ODbL-1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
      contact: { name: 'DarkRoute', url: 'https://github.com/darkcodelabs/darkroute' },
    },
    servers,
    paths: {
      '/api/v1/cameras': {
        get: {
          operationId: 'listCameras',
          summary: 'Cameras inside a bounding box',
          description:
            `A box may span at most ${String(MAX_SPAN_DEG)} degrees on a side and may open at most ` +
            `${String(MAX_TILES)} archive tiles. Those caps are the substantive protection on this API: ` +
            'they turn "download the country in one request" into "make thousands of requests", which ' +
            'the rate limiter can see. The answer is read through the same zoom-11 tile route the app ' +
            'uses, so it can never disagree with what a driver is shown.',
          parameters: [
            {
              name: 'bbox',
              in: 'query',
              required: true,
              description:
                `west,south,east,north in decimal degrees. Longitude -180..180, latitude -85..85, ` +
                `east > west, north > south, at most ${String(MAX_SPAN_DEG)} degrees a side.`,
              schema: { type: 'string', example: '-94.72,38.90,-94.58,39.02' },
            },
            {
              name: 'owner',
              in: 'query',
              required: false,
              description: 'Restrict to one ownership class.',
              schema: { type: 'string', enum: OWNER_TYPE_LIST },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: `Maximum cameras returned. 1-${String(MAX_LIMIT)}, default ${String(DEFAULT_LIMIT)}.`,
              schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
            },
          ],
          responses: {
            200: {
              description: 'Cameras in the box. `cache-control: public, max-age=300`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['attribution', 'licence', 'query', 'count', 'truncated', 'emptyTiles', 'cameras'],
                    properties: {
                      attribution: { type: 'string' },
                      licence: { type: 'string', const: 'ODbL-1.0' },
                      query: {
                        type: 'object',
                        description: 'The request as it was understood, so a caller can see what a filter did.',
                        required: ['bbox', 'owner', 'limit'],
                        properties: {
                          bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
                          owner: { type: ['string', 'null'], enum: [...OWNER_TYPE_LIST, null] },
                          limit: { type: 'integer' },
                        },
                      },
                      count: { type: 'integer' },
                      truncated: {
                        type: 'boolean',
                        description: 'True when more cameras exist in this box than were returned.',
                      },
                      emptyTiles: {
                        type: 'integer',
                        description:
                          'Archive tiles in this box holding no mapped camera. NOT the same as ' +
                          '`truncated`: this one says the map is empty there, not that the ' +
                          'answer was cut short.',
                      },
                      cameras: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: [
                            'id',
                            'lat',
                            'lon',
                            'ownerType',
                            'street',
                            'cross',
                            'directionDeg',
                            'operator',
                            'manufacturer',
                            'mount',
                            'locality',
                            'streetM',
                          ],
                          properties: {
                            id: { type: 'string' },
                            lat: { type: 'number' },
                            lon: { type: 'number' },
                            ownerType: { type: ['string', 'null'], enum: [...OWNER_TYPE_LIST, null] },
                            street: { type: ['string', 'null'] },
                            cross: { type: ['string', 'null'] },
                            directionDeg: {
                              type: ['number', 'null'],
                              description:
                                'Null on most records. OpenStreetMap ALPR nodes usually carry no ' +
                                'facing, and a default would invent coverage nobody recorded.',
                            },
                            operator: { type: ['string', 'null'] },
                            manufacturer: {
                              type: ['string', 'null'],
                              description: 'The `manufacturer` tag as mapped, e.g. "Flock Safety".',
                            },
                            mount: {
                              type: ['string', 'null'],
                              description: 'The `camera:mount` tag as mapped, e.g. "pole".',
                            },
                            locality: {
                              type: ['string', 'null'],
                              description:
                                'The city or town from the Census PLACE polygons, or "<Name> County" ' +
                                'outside every incorporated place. From the pinned release context.',
                            },
                            streetM: {
                              type: ['integer', 'null'],
                              description:
                                'Metres from the camera to `street`. Past about sixty the camera is ' +
                                'beside the road rather than on it.',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: refusal(
              'The box, owner or limit broke a constraint. `detail` says which. Do not retry unchanged.',
              ['bad_bbox', 'bad_owner', 'bad_limit', 'too_many_tiles'],
            ),
            429: RATE_LIMITED,
            503: refusal(
              'The camera archive did not answer. Nothing is served from a stale copy - an error is ' +
                'more honest than yesterday’s data presented as current.',
              ['archive_unavailable'],
            ),
          },
        },
      },
      '/api/v1/stats': {
        get: {
          operationId: 'getStats',
          summary: 'Archive size, generation and freshness',
          description:
            'Freshness is reported as the OpenStreetMap upstream timestamp as well as the build ' +
            'time, because a recent build of an old snapshot is old data. `generation` is the value ' +
            'the tile route stamps in `x-darkroute-camera-generation`, taken from that response rather ' +
            'than looked up twice, so it cannot disagree with what a tile request is served under.',
          responses: {
            200: {
              description: 'Current archive state. `cache-control: public, max-age=300`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: [
                      'cameras', 'generation', 'generatedAt', 'upstream', 'zoom', 'bbox', 'source',
                      'attribution', 'licence', 'abuseRecords', 'scope', 'caveat',
                    ],
                    properties: {
                      cameras: { type: 'integer', description: 'Camera nodes in the published archive.' },
                      generation: {
                        type: ['string', 'null'],
                        description: '64 hex characters identifying the published generation.',
                      },
                      generatedAt: { type: ['string', 'null'], description: 'When the archive was built (ISO 8601).' },
                      upstream: { type: ['string', 'null'], description: 'The OpenStreetMap snapshot it was built from.' },
                      zoom: { type: ['integer', 'null'], description: 'The archive’s tile zoom. 11.' },
                      bbox: { description: 'The archive’s own extent, as its manifest states it, or null.' },
                      source: { type: 'string' },
                      attribution: { type: 'string' },
                      licence: { type: 'string' },
                      abuseRecords: { type: 'integer', description: 'Rows in `/api/v1/abuse`.' },
                      scope: { type: 'string', description: 'What the camera count is a count of.' },
                      caveat: { type: 'string', description: 'The empty-means-unmapped warning, in the payload.' },
                    },
                  },
                },
              },
            },
            429: RATE_LIMITED,
            503: refusal('The archive index did not answer, or was not an object.', [
              'archive_unavailable',
              'archive_malformed',
            ]),
          },
        },
      },
      '/api/v1/abuse': {
        get: {
          operationId: 'listAbuseRecords',
          summary: 'Documented ALPR misuse records',
          description:
            'One row per county, each naming an agency and citing a source URL. Returned whole ' +
            'because splitting a citation set across pages makes it harder to check. Rows missing ' +
            'a citation are returned, not hidden, and counted in `uncited`.',
          responses: {
            200: {
              description: 'The record set. `cache-control: public, max-age=300`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['note', 'count', 'uncited', 'records'],
                    properties: {
                      note: { type: 'string' },
                      count: { type: 'integer' },
                      uncited: { type: 'integer', description: 'Rows whose `sourceUrl` is empty. Should be 0.' },
                      records: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['fips', 'agency', 'incidents', 'year', 'sourceName', 'summary', 'sourceUrl'],
                          properties: {
                            fips: { type: 'string', description: 'County FIPS code.' },
                            agency: { type: 'string' },
                            incidents: { type: 'integer' },
                            year: { type: 'integer' },
                            sourceName: { type: 'string' },
                            summary: { type: 'string' },
                            sourceUrl: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            429: RATE_LIMITED,
            503: refusal('The record set did not answer, or was not the expected shape.', [
              'records_unavailable',
              'records_malformed',
            ]),
          },
        },
      },
      '/api/v1/place': {
        get: {
          operationId: 'findPlace',
          summary: 'Find a place by name',
          description:
            'A proxy onto OpenStreetMap\'s own geocoder, restricted to the United States and Puerto ' +
            'Rico. It exists so the app never calls a geocoder from a phone: a direct call would hand ' +
            'a third party the caller\'s IP address alongside the name of where they are going, which ' +
            'is the pair this project exists to keep from being assembled. Answers are cached at the ' +
            `edge by query alone for an hour, so the same lookup by two callers is one upstream request. ` +
            `At most ${String(MAX_RESULTS)} places are returned.`,
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: MAX_QUERY },
              description: `The place to look for. Trimmed; at most ${String(MAX_QUERY)} characters.`,
            },
            {
              name: 'near',
              in: 'query',
              required: false,
              schema: { type: 'string', example: '39.09,-94.58' },
              description:
                '`lat,lon`. A PREFERENCE, not a filter - it biases results toward a 2-degree box ' +
                'around that point and still answers with somewhere a thousand miles away. A malformed ' +
                'value is ignored rather than refused.',
            },
          ],
          responses: {
            200: {
              description: 'Matching places, nearest-preferred. `cache-control: public, max-age=3600`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['query', 'places', 'attribution'],
                    properties: {
                      query: { type: 'string', description: 'The query as trimmed and forwarded.' },
                      places: {
                        type: 'array',
                        maxItems: MAX_RESULTS,
                        items: {
                          type: 'object',
                          required: ['name', 'detail', 'lat', 'lon'],
                          properties: {
                            name: { type: 'string', description: 'The first field of the geocoder’s display name.' },
                            detail: { type: 'string', description: 'The next few fields, for telling namesakes apart.' },
                            lat: { type: 'number' },
                            lon: { type: 'number' },
                          },
                        },
                      },
                      attribution: { type: 'string' },
                    },
                  },
                },
              },
            },
            400: refusal('No query, or one too long to be an address.', ['missing_query', 'query_too_long']),
            429: RATE_LIMITED,
            502: refusal('The geocoder could not be reached, refused, or returned something unreadable.', [
              'geocoder_unreachable',
              'geocoder_failed',
              'geocoder_unreadable',
            ]),
          },
        },
      },
      '/api/v1/route': {
        get: {
          operationId: 'planRoute',
          summary: 'A driving route that avoids given points',
          description:
            'Each point in `avoid` becomes a small polygon the router may not enter, so this ' +
            'answers "find a route that does not pass through any of these" rather than ' +
            'approximating it with waypoints - a waypoint says "go through here", which is the ' +
            'opposite request. Never cached (`cache-control: no-store`): unlike a place name, a route ' +
            `is one caller's origin and destination. Origin and destination may be at most ` +
            `${String(MAX_ROUTE_SPAN_DEG)} degrees apart in either axis.`,
          parameters: [
            {
              name: 'from',
              in: 'query',
              required: true,
              schema: { type: 'string', example: '39.0997,-94.5786' },
              description: '`lat,lon`. Latitude -90..90, longitude -180..180.',
            },
            {
              name: 'to',
              in: 'query',
              required: true,
              schema: { type: 'string', example: '39.0392,-94.5933' },
              description: '`lat,lon`.',
            },
            {
              name: 'avoid',
              in: 'query',
              required: false,
              schema: { type: 'string', example: '39.05,-94.58;39.06,-94.59' },
              description:
                `Up to ${String(MAX_EXCLUSIONS)} \`lat,lon\` points, semicolon separated. Each becomes a ` +
                '60 m half-width square the router may not enter. Malformed entries are dropped ' +
                'rather than refusing the whole request - a route avoiding 59 of 60 readers is ' +
                'worth more than no route. `avoided` in the answer says how many were kept.',
            },
          ],
          responses: {
            200: {
              description: 'The line to draw, its distance and duration, its turns, and how many points were avoided.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['shape', 'miles', 'seconds', 'avoided', 'maneuvers', 'attribution'],
                    properties: {
                      shape: {
                        type: 'array',
                        description: 'The route, in driving order.',
                        items: {
                          type: 'object',
                          required: ['lat', 'lon'],
                          properties: { lat: { type: 'number' }, lon: { type: 'number' } },
                        },
                      },
                      miles: { type: 'number' },
                      seconds: { type: 'number' },
                      avoided: { type: 'integer', description: 'How many `avoid` points the router was told to keep out of.' },
                      maneuvers: {
                        type: 'array',
                        description: 'Turns in driving order. Empty when the router gave none.',
                        items: {
                          type: 'object',
                          required: ['instruction', 'street', 'miles', 'seconds', 'turn', 'beginShapeIndex'],
                          properties: {
                            instruction: { type: 'string', description: 'The router’s own sentence.' },
                            street: { type: 'string', description: 'The street it puts you on, or "" where none is named.' },
                            miles: { type: 'number' },
                            seconds: { type: 'number' },
                            turn: {
                              type: 'string',
                              enum: [
                                'start', 'arrive', 'straight', 'left', 'right', 'sharp-left', 'sharp-right',
                                'slight-left', 'slight-right', 'uturn', 'merge', 'ramp', 'roundabout',
                              ],
                            },
                            beginShapeIndex: {
                              type: 'integer',
                              description: 'Index into `shape` where this maneuver begins - into the WHOLE route, not a leg.',
                            },
                          },
                        },
                      },
                      attribution: { type: 'string' },
                    },
                  },
                },
              },
            },
            400: refusal('A point is missing or malformed, or the two are further apart than one request may plan.', [
              'missing_points',
              'too_far',
            ]),
            409: refusal(
              'No driving route avoids all of those. A real answer, not a failure - retrying ' +
                'unchanged will not help; ask again with fewer exclusions.',
              ['no_route'],
            ),
            429: RATE_LIMITED,
            502: refusal('The router could not be reached, refused, or returned nothing usable.', [
              'router_unreachable',
              'router_failed',
              'router_unreadable',
              'router_empty',
            ]),
          },
        },
      },
      '/api/v1/openapi.json': {
        get: {
          operationId: 'getSpec',
          summary: 'This document',
          description:
            'OpenAPI 3.1. `servers` names the origin being called; from the canonical origin it also ' +
            'names the console alias.',
          responses: {
            200: { description: 'The spec. `cache-control: public, max-age=300`.', content: { 'application/json': { schema: { type: 'object' } } } },
            429: RATE_LIMITED,
          },
        },
      },
      '/api/v1/doc/{name}': {
        get: {
          operationId: 'getDocument',
          summary: 'A published document, as Markdown',
          description:
            'The public repository\'s documentation, fetched server-side and served from this origin ' +
            'so the app\'s Content-Security-Policy need not admit GitHub. The bytes are the ' +
            'repository\'s own - nothing is transformed - and `x-darkroute-source` names the file ' +
            'they came from. Only the names listed are served; anything else is 404, not an attempt.',
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: Object.keys(DOCS) },
            },
          ],
          responses: {
            200: {
              description: 'The document. `content-type: text/markdown`, `cache-control: public, max-age=900`.',
              headers: {
                'x-darkroute-source': {
                  schema: { type: 'string', format: 'uri' },
                  description: 'The raw GitHub URL the bytes were read from.',
                },
              },
              content: { 'text/markdown': { schema: { type: 'string' } } },
            },
            404: refusal('Not a document this route serves. `detail` lists the names that are.', ['unknown_document']),
            429: RATE_LIMITED,
            502: refusal('The repository did not return the file. Nothing is served from a cached copy.', [
              'document_unavailable',
            ]),
          },
        },
      },
      '/api/v1/submit': {
        post: {
          operationId: 'submitCorrection',
          summary: 'Propose a correction, as a public pull request',
          description:
            'Turns a correction into a pull request on the public repository - a branch named from a ' +
            'hash of the content, one file under `submissions/`, and a PR titled `[unreviewed]`. ' +
            'Nothing is merged automatically and nothing here touches the published archive; a person ' +
            'reviews it. The same submission sent twice lands on one branch and is reported as ' +
            '`duplicate: true`.\n\n' +
            `Anonymous, and treated as a spam vector: every field is validated and bounded, and each ` +
            `address may file ${String(MAX_PER_HOUR)} an hour on top of the general limit. ` +
            'A `contact` is optional and is the submitter\'s to give.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['kind'],
                  properties: {
                    kind: { type: 'string', enum: [...KINDS] },
                    cameraId: {
                      type: ['string', 'null'],
                      maxLength: 64,
                      pattern: '^[A-Za-z0-9:_-]+$',
                      description: 'Required unless `kind` is `new-camera`.',
                    },
                    lat: { type: ['number', 'null'], minimum: -85, maximum: 85, description: 'Required for `new-camera`.' },
                    lon: { type: ['number', 'null'], minimum: -180, maximum: 180, description: 'Required for `new-camera`.' },
                    field: { type: ['string', 'null'], enum: [...FIELDS, null], description: 'Which fact is wrong.' },
                    wrong: { type: ['string', 'null'], maxLength: 120, description: 'What the archive says now.' },
                    right: { type: ['string', 'null'], maxLength: 120, description: 'What it should say.' },
                    note: { type: ['string', 'null'], maxLength: 600 },
                    photoKey: {
                      type: ['string', 'null'],
                      pattern: PHOTO_KEY_PATTERN,
                      description: 'A key returned by `PUT /api/v1/photo`.',
                    },
                    contact: { type: ['string', 'null'], maxLength: 120 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'The pull request was opened, or already existed. `cache-control: no-store`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'url', 'branch', 'duplicate', 'note'],
                    properties: {
                      ok: { type: 'boolean', const: true },
                      url: { type: 'string', format: 'uri', description: 'The pull request. The receipt.' },
                      branch: { type: 'string' },
                      duplicate: { type: 'boolean', description: 'True when this exact submission had already been filed.' },
                      note: { type: 'string' },
                    },
                  },
                },
              },
            },
            400: refusal('The body is not JSON, or does not describe a submission. `detail` names the field.', [
              'bad_json',
              'bad_submission',
            ]),
            429: refusal(
              `Either the general limit or this route's own ${String(MAX_PER_HOUR)}-an-hour limit. ` +
                '`retry-after` says when.',
              ['rate_limited'],
            ),
            502: refusal(
              'GitHub refused a step. `detail` says whether anything was created; a failed branch ' +
                'creates nothing, a failed pull request leaves the branch.',
              ['repository_unavailable', 'branch_failed', 'write_failed', 'pull_request_failed'],
            ),
            503: refusal('This deployment has no submissions token. Nothing was queued or stored.', [
              'submissions_unconfigured',
            ]),
          },
        },
      },
      '/api/v1/photo': {
        put: {
          operationId: 'putPhoto',
          summary: 'Store a photograph for a submission',
          description:
            'The body is the image; the key is the SHA-256 of the bytes, so the same photo sent ' +
            'twice is one object and the key says nothing about who sent it or when. Nothing else is ' +
            'recorded. EXIF IS NOT STRIPPED HERE - a client must strip metadata before upload, because ' +
            'a phone photograph carries the position it was taken at. `/api/v1/photo/` with a trailing ' +
            'slash is accepted too.',
          requestBody: {
            required: true,
            description: `At most ${String(PHOTO_MAX_MB)} MiB. The bare media type in \`content-type\` picks the extension.`,
            content: Object.fromEntries(
              PHOTO_MEDIA_TYPES.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
            ),
          },
          responses: {
            200: {
              description: 'Stored. `cache-control: no-store`.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'key', 'bytes'],
                    properties: {
                      ok: { type: 'boolean', const: true },
                      key: { type: 'string', pattern: PHOTO_KEY_PATTERN, description: 'Pass as `photoKey` to /submit.' },
                      bytes: { type: 'integer' },
                    },
                  },
                },
              },
            },
            400: refusal('No bytes.', ['empty']),
            413: refusal(`Larger than ${String(PHOTO_MAX_MB)} MiB.`, ['too_large']),
            415: refusal(`\`content-type\` is not one of ${PHOTO_MEDIA_TYPES.join(', ')}.`, ['unsupported_type']),
            429: RATE_LIMITED,
            503: refusal('This deployment has nowhere to put a photo. Nothing was stored.', ['photos_unconfigured']),
          },
        },
      },
      '/api/v1/photo/{key}': {
        get: {
          operationId: 'getPhoto',
          summary: 'A stored photograph',
          description:
            'Content-addressed, so it can never change under its key: `cache-control: public, ' +
            'max-age=31536000, immutable`. Served with `content-security-policy: default-src \'none\'; ' +
            'sandbox` and `x-content-type-options: nosniff`, because it is a stranger\'s bytes.',
          parameters: [
            {
              name: 'key',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: PHOTO_KEY_PATTERN },
              description: 'A key this service issued. Anything else is 404 without a lookup.',
            },
          ],
          responses: {
            200: {
              description: 'The image bytes, under the media type they were stored with.',
              content: Object.fromEntries(
                PHOTO_MEDIA_TYPES.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
              ),
            },
            404: refusal('Not a key this service issued, or no such photo.', ['not_found']),
            429: RATE_LIMITED,
            503: refusal('This deployment has no photo store.', ['photos_unconfigured']),
          },
        },
      },
    },
    components: {
      responses: {
        RateLimited: {
          description:
            'Too many requests from this address. `retry-after` says when. If you need bulk ' +
            'access, take the published dataset instead of waiting this out.',
          headers: {
            'Retry-After': { schema: { type: 'integer' }, description: 'Seconds until the window resets.' },
            'RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests per window. 60.' },
            'RateLimit-Remaining': { schema: { type: 'integer' } },
            'RateLimit-Reset': { schema: { type: 'integer' }, description: 'Seconds until the window resets.' },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['error', 'detail', 'retryAfterSeconds'],
                properties: {
                  error: { type: 'string', enum: ['rate_limited'] },
                  detail: { type: 'string' },
                  retryAfterSeconds: { type: 'integer' },
                },
              },
            },
          },
        },
        MethodNotAllowed: {
          description:
            'The path exists and does not take this method. `allow` lists what it takes. Applies to ' +
            'every path above and is not repeated on each.',
          headers: { Allow: { schema: { type: 'string' }, description: 'e.g. `GET, HEAD, OPTIONS`.' } },
          content: errorBody(['method_not_allowed']),
        },
        NotFound: {
          description:
            'Nothing under `/api/v1/` answers to that path. `available` lists every route, as ' +
            '`METHOD /path`. Applies to any path not listed above.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['error', 'detail', 'available'],
                properties: {
                  error: { type: 'string', enum: ['not_found'] },
                  detail: { type: 'string' },
                  available: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  });
};
