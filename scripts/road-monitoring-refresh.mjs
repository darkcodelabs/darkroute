#!/usr/bin/env node
/** Scheduled refresh, using the same producer and conditional publisher as a manual run. */
import { collectRoadMonitoring } from './build-road-monitoring.mjs';
import { readPublishedMonitoring, publishMonitoring } from './road-monitoring-publish.mjs';

const previous = await readPublishedMonitoring();
const snapshot = await collectRoadMonitoring({ previous: previous?.snapshot ?? null,
  onSource: (source) => console.log(JSON.stringify(source)) });
await publishMonitoring(snapshot, { expectedEtag: previous?.etag ?? null,
  previousGeneratedAt: previous?.snapshot.generatedAt ?? null });
console.log(`Published ${snapshot.records.length} monitoring locations from ${snapshot.sources.length} source inventories`);
