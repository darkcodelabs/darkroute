#!/usr/bin/env node
/** Run the production Atlas builder and publish its validated snapshot. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { publishAtlas } from './atlas-publish.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'darkroute-atlas-'));
try {
  const output = join(directory, 'atlas-counties.json');
  const args = ['--dns-result-order=ipv4first', join(root, 'scripts/build-atlas-counties.mjs'), '--output', output];
  if (process.env.ATLAS_CACHE_DIR) args.push('--cache', process.env.ATLAS_CACHE_DIR);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: 600_000 });
  if (result.error || result.status !== 0) throw new Error('Atlas builder failed; keeping the published snapshot');
  const snapshot = JSON.parse(await readFile(output, 'utf8'));
  const published = await publishAtlas(snapshot);
  console.log(`Published Atlas: ${published.counties} counties, checked ${published.checkedAt}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
