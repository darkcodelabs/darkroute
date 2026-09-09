import { createHash } from 'node:crypto';

import {
  createTerritorialFootprint,
  forEachElementBytes,
  materialiseStagedUpsert,
  parseSequenceState,
  reconcileTombstones,
  stageElementChange,
} from './sync-cameras.mjs';

export const REPLAY_ROOT = 'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour';
export const MAX_REPLAY_STATE_BYTES = 64 * 1024;
export const MAX_REPLAY_DIFF_BYTES = 64 * 1024 * 1024;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sequencePath(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error(`invalid replay sequence ${String(sequence)}`);
  }
  return String(sequence).padStart(9, '0').match(/.{3}/g).join('/');
}

export const replayStateUrl = (sequence) => `${REPLAY_ROOT}/${sequencePath(sequence)}.state.txt`;
export const replayDiffUrl = (sequence) => `${REPLAY_ROOT}/${sequencePath(sequence)}.osc.gz`;

export async function fetchExactReplayBytes(url, maximum, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: '*/*',
      'Cache-Control': 'no-cache',
      'User-Agent':
        'DarkRoute-camera-continuity/1.0 (+https://darkroute.ai; contact cory@darkcode.ai)',
    },
  });
  if (!response.ok || response.status !== 200) {
    throw new Error(`${url}: HTTP ${String(response.status)}`);
  }
  if (response.url !== url) throw new Error(`${url}: resolved to ${String(response.url)}`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new Error(`${url}: response exceeds its byte limit`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > maximum) {
    throw new Error(`${url}: response has invalid size ${String(bytes.length)}`);
  }
  return bytes;
}

export async function fetchReplaySequence(sequence, fetchImpl = fetch) {
  const stateUrl = replayStateUrl(sequence);
  const diffUrl = replayDiffUrl(sequence);
  const stateBytes = await fetchExactReplayBytes(stateUrl, MAX_REPLAY_STATE_BYTES, fetchImpl);
  const state = parseSequenceState(stateBytes.toString('utf8'), {
    expectedSeq: sequence,
    label: stateUrl,
  });
  const diffBytes = await fetchExactReplayBytes(diffUrl, MAX_REPLAY_DIFF_BYTES, fetchImpl);
  return {
    state,
    diffBytes,
    identity: {
      sequence,
      timestamp: state.timestamp,
      stateUrl,
      stateBytes: stateBytes.length,
      stateSha256: sha256(stateBytes),
      diffUrl,
      diffBytes: diffBytes.length,
      diffSha256: sha256(diffBytes),
    },
  };
}

function indexedLive(records) {
  const live = new Map();
  for (const record of records) {
    if (typeof record?.id !== 'string' || live.has(record.id)) {
      throw new Error(`replay baseline has invalid or duplicate live id ${String(record?.id)}`);
    }
    live.set(record.id, record);
  }
  return live;
}

function indexedTombstones(records) {
  const tombstones = new Map();
  for (const record of records) {
    if (typeof record?.id !== 'string' || tombstones.has(record.id)) {
      throw new Error(
        `replay baseline has invalid or duplicate tombstone id ${String(record?.id)}`,
      );
    }
    tombstones.set(record.id, record);
  }
  return tombstones;
}

/**
 * Independently apply an exact contiguous official hourly range to one semantic
 * camera core. This deliberately shares the pure decision/order functions with
 * the patrol but does not trust the patrol's local writes or claimed journal.
 */
export async function replayCameraCore({
  live: baseLive,
  tombstones: baseTombstones,
  fromSequence,
  throughSequence,
  countyIndex,
  fetchImpl = fetch,
}) {
  if (
    !Number.isSafeInteger(fromSequence) ||
    fromSequence < 0 ||
    !Number.isSafeInteger(throughSequence) ||
    throughSequence < fromSequence
  ) {
    throw new Error('camera replay range is invalid');
  }
  const live = indexedLive(baseLive);
  const baselineTombstones = indexedTombstones(baseTombstones);
  for (const id of baselineTombstones.keys()) {
    if (live.has(id)) throw new Error(`camera replay starts with live/tombstone overlap ${id}`);
  }
  const inside = createTerritorialFootprint(countyIndex);
  const upserts = new Map();
  const pendingTombstones = new Map();
  const diffs = [];
  let previousTimestamp = null;

  for (let sequence = fromSequence + 1; sequence <= throughSequence; sequence += 1) {
    const fetched = await fetchReplaySequence(sequence, fetchImpl);
    if (
      previousTimestamp !== null &&
      Date.parse(fetched.state.timestamp) < Date.parse(previousTimestamp)
    ) {
      throw new Error('official camera replication timestamps moved backwards');
    }
    previousTimestamp = fetched.state.timestamp;
    await forEachElementBytes(fetched.diffBytes, (element) => {
      const id = `osm:${String(element.id)}`;
      stageElementChange(
        element,
        sequence,
        baselineTombstones.get(id) ?? live.get(id),
        upserts,
        pendingTombstones,
        inside,
      );
    });
    diffs.push(fetched.identity);
  }

  for (const id of pendingTombstones.keys()) live.delete(id);
  for (const [id, upsert] of upserts) {
    const { record } = materialiseStagedUpsert(upsert, countyIndex);
    live.set(id, record);
  }
  const tombstones = reconcileTombstones(
    [...baselineTombstones.values()],
    pendingTombstones,
    upserts,
  );
  return {
    live: [...live.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
    tombstones,
    diffs,
    timestamp: diffs.length === 0 ? null : diffs.at(-1).timestamp,
  };
}
