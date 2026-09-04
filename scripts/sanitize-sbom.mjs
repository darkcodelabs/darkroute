import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const target =
  process.argv[2] === undefined
    ? resolve(ROOT, 'sbom/sbom.json')
    : resolve(process.cwd(), process.argv[2]);

const LOCAL_NODE_MODULES_PATHS = new Set(['internal:LocalNodeModulesPath', 'LocalNodeModulesPath']);
const NPM_PACKAGE_JSON = 'cdx:npm:package_json';
const PRIVATE_CHECKOUT_NAME = 'flockyswatchingme';
const MESHTASTIC_PROTOBUF_PURL = 'pkg:npm/%40jsr/meshtastic__protobufs@2.7.26';
const MESHTASTIC_PROTOBUF_LICENSE_URL =
  'https://github.com/meshtastic/protobufs/blob/v2.7.26/LICENSE';
const MESHTASTIC_PROTOBUF_RELEASE_URL = 'https://jsr.io/@meshtastic/protobufs@2.7.26';
const LICENSE_EVIDENCE = 'darkroute:license-evidence';
const LICENSE_EVIDENCE_SCHEMA = 'darkroute-sbom-license-evidence/v1';
const LICENSE_EVIDENCE_PATH = resolve(ROOT, 'scripts/data/sbom-license-evidence.json');
const NPM_REGISTRY = 'https://registry.npmjs.org/';
const EVIDENCED_LICENSE_EXPRESSIONS = new Set([
  'Apache-2.0',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT OR Apache-2.0',
  'MIT-0',
  'MPL-2.0',
]);
const MANIFEST_IMPORTERS = [
  { component: 'darkroute', manifest: 'package.json' },
  { component: '@fwm/pwa', manifest: 'apps/pwa/package.json' },
  { component: '@fwm/api-client', manifest: 'packages/api-client/package.json' },
  { component: '@fwm/core', manifest: 'packages/core/package.json' },
];

let removedLocalPaths = 0;
let normalizedManifests = 0;
let reconciledDependencyEdges = 0;
let reconciledLicenses = 0;

function flattenComponents(components = []) {
  return components.flatMap((component) => [component, ...flattenComponents(component.components)]);
}

function componentName(component) {
  return component.group ? `${component.group}/${component.name}` : component.name;
}

function hasExactKeys(value, keys) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

function npmMetadataUrl(name, version) {
  return `${NPM_REGISTRY}${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

function sha512(component) {
  const digest = component.hashes?.find((hash) => hash.alg === 'SHA-512')?.content;
  if (!/^[0-9a-f]{128}$/.test(digest ?? '')) {
    throw new Error(`${component['bom-ref']} has no exact SHA-512 package digest`);
  }
  return digest;
}

function licenseChoice(expression) {
  return /\s(?:AND|OR)\s/.test(expression) ? { expression } : { license: { id: expression } };
}

function reconcileMissingLicenses(bom) {
  const evidence = JSON.parse(readFileSync(LICENSE_EVIDENCE_PATH, 'utf8'));
  if (
    !hasExactKeys(evidence, ['schema', 'registry', 'description', 'components']) ||
    evidence.schema !== LICENSE_EVIDENCE_SCHEMA ||
    evidence.registry !== NPM_REGISTRY ||
    typeof evidence.description !== 'string' ||
    evidence.description.trim() === '' ||
    !Array.isArray(evidence.components) ||
    evidence.components.length !== 201
  ) {
    throw new Error('SBOM licence evidence has an invalid manifest');
  }

  const components = new Map(bom.components?.map((component) => [component['bom-ref'], component]));
  const seen = new Set();
  let previousRef = '';
  for (const entry of evidence.components) {
    if (
      !hasExactKeys(entry, ['ref', 'name', 'version', 'license', 'integrity', 'metadataUrl']) ||
      typeof entry.ref !== 'string' ||
      entry.ref.localeCompare(previousRef) <= 0 ||
      seen.has(entry.ref) ||
      !EVIDENCED_LICENSE_EXPRESSIONS.has(entry.license) ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity ?? '') ||
      entry.metadataUrl !== npmMetadataUrl(entry.name, entry.version)
    ) {
      throw new Error('SBOM licence evidence contains an invalid or unsorted record');
    }

    const component = components.get(entry.ref);
    if (
      component === undefined ||
      componentName(component) !== entry.name ||
      component.version !== entry.version ||
      Buffer.from(entry.integrity.slice('sha512-'.length), 'base64').toString('hex') !==
        sha512(component)
    ) {
      throw new Error(`SBOM licence evidence does not match ${entry.ref}`);
    }

    if (!Array.isArray(component.licenses) || component.licenses.length === 0) {
      reconciledLicenses += 1;
    }
    component.licenses = [licenseChoice(entry.license)];
    const properties = Array.isArray(component.properties)
      ? component.properties.filter((property) => property?.name !== LICENSE_EVIDENCE)
      : [];
    component.properties = [...properties, { name: LICENSE_EVIDENCE, value: entry.metadataUrl }];

    seen.add(entry.ref);
    previousRef = entry.ref;
  }

  const unlicensed = bom.components?.filter(
    (component) => !Array.isArray(component.licenses) || component.licenses.length === 0,
  );
  if (unlicensed?.length !== 0) {
    throw new Error(
      `SBOM still has ${String(unlicensed.length)} unlicensed components: ${unlicensed
        .slice(0, 8)
        .map((component) => component['bom-ref'])
        .join(', ')}`,
    );
  }
}

function dependencyMap(bom) {
  const dependencies = new Map(
    bom.dependencies?.map((dependency) => [dependency.ref, dependency]) ?? [],
  );
  return dependencies;
}

function exactVersionHint(specifier) {
  if (typeof specifier !== 'string') return undefined;
  return specifier.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0];
}

function resolveComponent(componentsByName, name, specifier) {
  const candidates = componentsByName.get(name) ?? [];
  const hintedVersion = exactVersionHint(specifier);
  const hinted =
    hintedVersion === undefined
      ? []
      : candidates.filter((component) => component.version === hintedVersion);

  if (hinted.length === 1) return hinted[0];
  if (candidates.length === 1) return candidates[0];

  throw new Error(
    `cannot resolve SBOM component for ${name}@${String(specifier)} (${String(candidates.length)} candidates)`,
  );
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  return trimmed;
}

function splitVersionedPackage(value) {
  let packageSpec = unquoteYamlScalar(value);
  const peerContext = packageSpec.indexOf('(');
  if (peerContext !== -1) packageSpec = packageSpec.slice(0, peerContext);
  if (packageSpec.startsWith('npm:')) packageSpec = packageSpec.slice(4);

  const separator = packageSpec.lastIndexOf('@');
  if (separator <= 0 || separator === packageSpec.length - 1) {
    throw new Error(`cannot parse pnpm package key: ${value}`);
  }
  return {
    name: packageSpec.slice(0, separator),
    version: packageSpec.slice(separator + 1),
  };
}

function parsePnpmSnapshotEdges(source) {
  const edges = [];
  let inSnapshots = false;
  let parent;
  let dependencyGroup = false;

  for (const [index, line] of source.split('\n').entries()) {
    if (line === 'snapshots:') {
      inSnapshots = true;
      continue;
    }
    if (!inSnapshots) continue;
    if (/^\S/.test(line) && line.trim() !== '') break;

    const parentMatch = line.match(/^ {2}(\S.*):$/);
    if (parentMatch !== null) {
      parent = splitVersionedPackage(parentMatch[1]);
      dependencyGroup = false;
      continue;
    }

    const groupMatch = line.match(/^ {4}(\S[^:]*):$/);
    if (groupMatch !== null) {
      dependencyGroup = ['dependencies', 'optionalDependencies'].includes(groupMatch[1]);
      continue;
    }
    if (!dependencyGroup) continue;

    const childMatch = line.match(/^ {6}(\S.*?): (.+)$/);
    if (childMatch === null) continue;
    if (parent === undefined) {
      throw new Error(`pnpm dependency has no snapshot parent at line ${String(index + 1)}`);
    }

    const declaredName = unquoteYamlScalar(childMatch[1]);
    const declaredVersion = unquoteYamlScalar(childMatch[2]);
    const child =
      declaredVersion.startsWith('@') || declaredVersion.startsWith('npm:')
        ? splitVersionedPackage(declaredVersion)
        : {
            name: declaredName,
            version: declaredVersion.split('(')[0],
          };
    edges.push({ parent, child });
  }

  if (edges.length < 1_000) {
    throw new Error(`pnpm snapshot parser found only ${String(edges.length)} dependency edges`);
  }
  return edges;
}

function reconcileDependencyGraph(bom) {
  const components = [
    ...flattenComponents([bom.metadata?.component]),
    ...flattenComponents(bom.components),
  ].filter(Boolean);
  const componentsByName = new Map();
  for (const component of components) {
    const name = componentName(component);
    const candidates = componentsByName.get(name) ?? [];
    candidates.push(component);
    componentsByName.set(name, candidates);
  }

  const dependencies = dependencyMap(bom);
  const expected = new Map(components.map((component) => [component['bom-ref'], new Set()]));
  const addExpectedEdge = (parent, child) => {
    const parentEdges = expected.get(parent['bom-ref']);
    if (parentEdges === undefined)
      throw new Error(`dependency node is missing: ${parent['bom-ref']}`);
    parentEdges.add(child['bom-ref']);
  };

  for (const importer of MANIFEST_IMPORTERS) {
    const parent = resolveComponent(componentsByName, importer.component, undefined);
    const manifest = JSON.parse(readFileSync(resolve(ROOT, importer.manifest), 'utf8'));
    const declarations = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    for (const [name, specifier] of Object.entries(declarations)) {
      addExpectedEdge(parent, resolveComponent(componentsByName, name, specifier));
    }
  }

  // cdxgen 12.8.4 inventories every pnpm-lock component, but its graph omits
  // some ordinary, peer-resolved, and optional dependencies. Derive the exact
  // union from pnpm's snapshots rather than guessing native-package families.
  const lockSource = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8');
  for (const edge of parsePnpmSnapshotEdges(lockSource)) {
    const parent = resolveComponent(componentsByName, edge.parent.name, edge.parent.version);
    const child = resolveComponent(componentsByName, edge.child.name, edge.child.version);
    addExpectedEdge(parent, child);
  }

  // The root application aggregates the three pnpm workspace applications;
  // these are CycloneDX structure edges rather than pnpm-lock package edges.
  const rootComponent = resolveComponent(componentsByName, 'darkroute', undefined);
  for (const importer of MANIFEST_IMPORTERS.slice(1)) {
    addExpectedEdge(
      rootComponent,
      resolveComponent(componentsByName, importer.component, undefined),
    );
  }

  for (const [parentRef, expectedChildren] of expected) {
    const dependency = dependencies.get(parentRef);
    if (dependency === undefined) throw new Error(`dependency node is missing: ${parentRef}`);
    const previous = new Set(dependency.dependsOn);
    for (const childRef of previous) {
      if (!expectedChildren.has(childRef)) reconciledDependencyEdges += 1;
    }
    for (const childRef of expectedChildren) {
      if (!previous.has(childRef)) reconciledDependencyEdges += 1;
    }
    dependency.dependsOn = [...expectedChildren].sort();
  }

  const known = new Set(components.map((component) => component['bom-ref']));
  const rootRef = bom.metadata?.component?.['bom-ref'];
  const reachable = new Set([rootRef]);
  const queue = [rootRef];
  while (queue.length > 0) {
    const parentRef = queue.shift();
    const dependency = dependencies.get(parentRef);
    if (dependency === undefined) throw new Error(`dependency node is missing: ${parentRef}`);
    for (const childRef of dependency.dependsOn) {
      if (!known.has(childRef)) {
        throw new Error(`${parentRef} depends on unknown component: ${childRef}`);
      }
      if (reachable.has(childRef)) continue;
      reachable.add(childRef);
      queue.push(childRef);
    }
  }

  const unreachable = components.filter((component) => !reachable.has(component['bom-ref']));
  if (unreachable.length > 0) {
    throw new Error(
      `SBOM dependency graph has ${String(unreachable.length)} unreachable components: ${unreachable
        .slice(0, 8)
        .map((component) => component['bom-ref'])
        .join(', ')}`,
    );
  }
}

function reconcileMeshtasticProtobufLicense(bom) {
  const component = bom.components?.find(
    (candidate) => candidate?.purl === MESHTASTIC_PROTOBUF_PURL,
  );
  if (component === undefined) {
    throw new Error(`required SBOM component is missing: ${MESHTASTIC_PROTOBUF_PURL}`);
  }

  // The JSR-to-npm package.json omits `license`. The exact JSR release declares
  // GPL-3.0-only and the published tarball carries the full GPLv3 LICENSE, so
  // preserve that evidence when cdxgen cannot infer it from package.json.
  component.licenses = [
    {
      license: {
        id: 'GPL-3.0-only',
        url: MESHTASTIC_PROTOBUF_RELEASE_URL,
      },
    },
  ];

  const references = Array.isArray(component.externalReferences)
    ? component.externalReferences.filter(
        (reference) =>
          reference?.url !== MESHTASTIC_PROTOBUF_LICENSE_URL &&
          reference?.url !== MESHTASTIC_PROTOBUF_RELEASE_URL,
      )
    : [];
  component.externalReferences = [
    ...references,
    { type: 'license', url: MESHTASTIC_PROTOBUF_LICENSE_URL },
    { type: 'website', url: MESHTASTIC_PROTOBUF_RELEASE_URL },
  ];

  const properties = Array.isArray(component.properties)
    ? component.properties.filter((property) => property?.name !== LICENSE_EVIDENCE)
    : [];
  component.properties = [
    ...properties,
    {
      name: LICENSE_EVIDENCE,
      value: 'JSR release metadata plus LICENSE bundled in the exact 2.7.26 tarball',
    },
  ];
}

function portableManifestPath(value) {
  if (!isAbsolute(value) && !win32.isAbsolute(value)) return value.replaceAll('\\', '/');

  const fromRoot = relative(ROOT, value);
  if (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)) {
    return fromRoot.split(sep).join('/');
  }

  const portable = value.replaceAll('\\', '/');
  for (const marker of ['/apps/', '/packages/']) {
    const index = portable.lastIndexOf(marker);
    if (index !== -1 && portable.endsWith('/package.json')) return portable.slice(index + 1);
  }
  if (portable.endsWith('/package.json')) return 'package.json';

  throw new Error(`cannot make npm manifest path repository-relative: ${value}`);
}

function sanitize(value) {
  if (Array.isArray(value)) {
    for (const item of value) sanitize(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value.properties)) {
    value.properties = value.properties.filter((property) => {
      if (!LOCAL_NODE_MODULES_PATHS.has(property?.name)) return true;
      removedLocalPaths += 1;
      return false;
    });

    for (const property of value.properties) {
      if (property?.name !== NPM_PACKAGE_JSON || typeof property.value !== 'string') continue;
      const portable = portableManifestPath(property.value);
      if (portable !== property.value) normalizedManifests += 1;
      property.value = portable;
    }
  }

  for (const nested of Object.values(value)) sanitize(nested);
}

function assertPublishable(value, trail = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublishable(item, `${trail}[${String(index)}]`));
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value !== 'string') return;
    const absolute = /^\/(?!\/)/.test(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value);
    if (absolute) throw new Error(`local absolute path remains at ${trail}: ${value}`);
    if (value.toLowerCase().includes(PRIVATE_CHECKOUT_NAME)) {
      throw new Error(`private checkout identifier remains at ${trail}`);
    }
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    assertPublishable(nested, `${trail}.${key}`);
  }
}

const bom = JSON.parse(readFileSync(target, 'utf8'));
reconcileMeshtasticProtobufLicense(bom);
reconcileMissingLicenses(bom);
reconcileDependencyGraph(bom);
sanitize(bom);
assertPublishable(bom);
writeFileSync(target, `${JSON.stringify(bom, null, 2)}\n`);

console.log(
  `Sanitized ${target}: removed ${String(removedLocalPaths)} local node_modules paths; normalized ${String(normalizedManifests)} manifest paths; reconciled ${String(reconciledDependencyEdges)} dependency edges and ${String(reconciledLicenses)} licences.`,
);
