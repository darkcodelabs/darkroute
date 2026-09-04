#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BOM_PATH = resolve(ROOT, 'sbom/sbom.json');
const EVIDENCE_PATH = resolve(ROOT, 'scripts/data/sbom-license-evidence.json');
const REGISTRY = 'https://registry.npmjs.org/';
const SCHEMA = 'darkroute-sbom-license-evidence/v1';
const CONCURRENCY = 16;

const ALLOWED_EXPRESSIONS = new Set([
  'Apache-2.0',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT OR Apache-2.0',
  'MIT-0',
  'MPL-2.0',
]);

function packageName(component) {
  return component.group ? `${component.group}/${component.name}` : component.name;
}

function metadataUrl(name, version) {
  return `${REGISTRY}${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

function sha512(component) {
  const digest = component.hashes?.find((hash) => hash.alg === 'SHA-512')?.content;
  if (!/^[0-9a-f]{128}$/.test(digest ?? '')) {
    throw new Error(`${component['bom-ref']} has no exact SHA-512 package digest`);
  }
  return digest;
}

async function registryEvidence(component) {
  const name = packageName(component);
  const url = metadataUrl(name, component.version);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  const metadata = await response.json();
  if (
    metadata.name !== name ||
    metadata.version !== component.version ||
    typeof metadata.license !== 'string' ||
    !ALLOWED_EXPRESSIONS.has(metadata.license) ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist?.integrity ?? '') ||
    Buffer.from(metadata.dist.integrity.slice('sha512-'.length), 'base64').toString('hex') !==
      sha512(component)
  ) {
    throw new Error(`${url}: package identity, licence, or integrity is not reviewable`);
  }

  return {
    ref: component['bom-ref'],
    name,
    version: component.version,
    license: metadata.license,
    integrity: metadata.dist.integrity,
    metadataUrl: url,
  };
}

const bom = JSON.parse(readFileSync(BOM_PATH, 'utf8'));
let previous = { components: [] };
try {
  previous = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const previousRefs = new Set(previous.components?.map((component) => component.ref) ?? []);
const candidates = bom.components
  .filter(
    (component) =>
      !Array.isArray(component.licenses) ||
      component.licenses.length === 0 ||
      previousRefs.has(component['bom-ref']),
  )
  .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));

const components = [];
for (let index = 0; index < candidates.length; index += CONCURRENCY) {
  components.push(
    ...(await Promise.all(candidates.slice(index, index + CONCURRENCY).map(registryEvidence))),
  );
}

const evidence = {
  schema: SCHEMA,
  registry: REGISTRY,
  description:
    'Exact-version npm package metadata for components whose cdxgen 12.8.4 records omit licence fields; package integrity is cross-checked against the pnpm-lock-derived SBOM hash.',
  components,
};
writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Wrote ${String(components.length)} exact package licence records to ${EVIDENCE_PATH}`);
