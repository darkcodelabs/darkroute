/**
 * THE SPEC AGAINST THE CODE.
 *
 * `openapi.json.ts` is hand-written, and hand-written drifted: it said "no
 * write path" after two shipped, listed six of nine paths, and enumerated one
 * endpoint's error codes under a component every endpoint used. This file is
 * the reason that cannot recur silently.
 *
 * Three comparisons, none of which trusts the spec's own word:
 *
 *   1. Its paths and methods are exactly the route table in `_routes.ts` -
 *      the same table the middleware gates methods with.
 *   2. For every handler file, the `error:` codes in its SOURCE are exactly the
 *      codes the spec enumerates for that file's operations (plus the
 *      middleware's `rate_limited`, which every route can return).
 *   3. Every `$ref` resolves.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { onRequestGet } from './openapi.json.ts';
import { ROUTES } from './_routes.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

type Json = Record<string, unknown>;

async function spec(origin = 'https://darkroute.ai'): Promise<Json> {
  const response = await onRequestGet({
    request: new Request(`${origin}/api/v1/openapi.json`),
    env: {},
  } as never);
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(200);
  expect((response as Response).headers.get('content-type')).toBe('application/json; charset=utf-8');
  return (await (response as Response).json()) as Json;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follow a `#/a/b/c` pointer. */
function resolve(document: Json, ref: string): unknown {
  expect(ref.startsWith('#/')).toBe(true);
  let node: unknown = document;
  for (const segment of ref.slice(2).split('/')) {
    expect(isRecord(node)).toBe(true);
    node = (node as Json)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    expect(node, `unresolved $ref ${ref}`).toBeDefined();
  }
  return node;
}

/** Every `$ref` string anywhere in the document. */
function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => refs(item, found));
  else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else refs(value, found);
    }
  }
  return found;
}

/** The `error` enum of one response object, following a $ref if it is one. */
function codesOf(document: Json, response: unknown): string[] {
  const resolved = isRecord(response) && typeof response['$ref'] === 'string' ? resolve(document, response['$ref']) : response;
  if (!isRecord(resolved)) return [];
  const content = resolved['content'];
  if (!isRecord(content)) return [];
  const media = content['application/json'];
  if (!isRecord(media)) return [];
  const schema = media['schema'];
  if (!isRecord(schema)) return [];
  const properties = schema['properties'];
  if (!isRecord(properties)) return [];
  const error = properties['error'];
  if (!isRecord(error) || !Array.isArray(error['enum'])) return [];
  return error['enum'].filter((code): code is string => typeof code === 'string');
}

/**
 * The error codes a handler's source can produce.
 *
 * A line that assigns `error:` a quoted snake_case literal - directly, or
 * through a ternary - before any `detail:` on the same line. Object-literal
 * schemas (`error: { type: ... }`) are skipped by the brace exclusion.
 */
function codesInSource(file: string): Set<string> {
  const source = readFileSync(join(HERE, file), 'utf8');
  const codes = new Set<string>();
  for (const line of source.split('\n')) {
    const match = /\berror:\s*([^{}\n]*)/.exec(line);
    if (match === null) continue;
    const segment = (match[1] ?? '').split('detail:')[0] ?? '';
    for (const literal of segment.matchAll(/'([a-z][a-z_]+)'/g)) {
      if (literal[1] !== undefined) codes.add(literal[1]);
    }
  }
  return codes;
}

describe('the OpenAPI document', () => {
  it('lists exactly the routes the middleware serves, method for method', async () => {
    const document = await spec();
    const paths = document['paths'] as Record<string, Json>;

    expect(Object.keys(paths).sort()).toEqual(ROUTES.map((route) => route.path).sort());

    for (const route of ROUTES) {
      const operations = Object.keys(paths[route.path] ?? {}).sort();
      expect(operations, route.path).toEqual(route.methods.map((method) => method.toLowerCase()).sort());
    }
  });

  it('enumerates, per handler file, exactly the error codes that file can emit', async () => {
    const document = await spec();
    const paths = document['paths'] as Record<string, Json>;

    const files = [...new Set(ROUTES.map((route) => route.file))];
    for (const file of files) {
      const documented = new Set<string>();
      for (const route of ROUTES.filter((candidate) => candidate.file === file)) {
        for (const operation of Object.values(paths[route.path] ?? {})) {
          if (!isRecord(operation) || !isRecord(operation['responses'])) continue;
          for (const response of Object.values(operation['responses'])) {
            codesOf(document, response).forEach((code) => documented.add(code));
          }
        }
      }
      // The spec's own file refuses nothing; everything else is compared to its source.
      const expected = file === 'openapi.json.ts' ? new Set<string>() : codesInSource(file);
      // The middleware can 429 any route, and the spec says so on every one.
      expected.add('rate_limited');
      expect([...documented].sort(), file).toEqual([...expected].sort());
    }
  });

  it('documents the middleware refusals every path shares', async () => {
    const document = await spec();
    const responses = (document['components'] as Json)['responses'] as Json;
    expect(codesOf(document, responses['RateLimited'])).toEqual(['rate_limited']);
    expect(codesOf(document, responses['MethodNotAllowed'])).toEqual(['method_not_allowed']);
    expect(codesOf(document, responses['NotFound'])).toEqual(['not_found']);
    const rateLimited = responses['RateLimited'] as Json;
    expect(Object.keys(rateLimited['headers'] as Json)).toEqual(
      expect.arrayContaining(['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset']),
    );
  });

  it('has no dangling $ref', async () => {
    const document = await spec();
    const all = refs(document);
    expect(all.length).toBeGreaterThan(0);
    for (const ref of all) resolve(document, ref);
  });

  it('names the canonical origin and the console alias from the canonical origin, and itself alone elsewhere', async () => {
    const canonical = (await spec())['servers'] as { url: string }[];
    expect(canonical.map((server) => server.url)).toEqual(['https://darkroute.ai', 'https://api.darkroute.ai']);

    const preview = (await spec('https://abc123.darkroute.pages.dev'))['servers'] as { url: string }[];
    expect(preview.map((server) => server.url)).toEqual(['https://abc123.darkroute.pages.dev']);
  });

  it('quotes the caps the handlers enforce rather than copies of them', async () => {
    const document = await spec();
    const paths = document['paths'] as Record<string, Json>;
    const cameras = (paths['/api/v1/cameras'] as Json)['get'] as Json;
    expect(cameras['description']).toContain('1.5 degrees');
    expect(cameras['description']).toContain('24 archive tiles');
    const description = (document['info'] as Json)['description'] as string;
    expect(description).not.toContain('no write path');
    expect(description).toContain('POST /api/v1/submit');
    expect(description).toContain('404 not_found');
  });
});
