import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cassette, StoredAudioReference, Track } from '@runman/shared';
import { createPublicSync, snapshotVisibility, type PublicSyncDependencies } from '../src/api/publicSync';

const now = '2026-11-14T01:00:00.000Z';
const ref: StoredAudioReference = { source: 'recording', objectKey: 'private/alice/media/aaaaaaaa-aaaa-4aaa-8aaa-000000000001', contentType: 'audio/webm', sizeBytes: 10 };
const recording: Track = { id: 'r', title: 'Voice memo', artist: 'Me', durationSec: 5, side: 'A', source: 'recording', audioReference: ref };
function tape(visibility?: 'public' | 'private'): Cassette {
  return { id: 'tape-1', name: 'Mix', shellColor: '#111111', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'clean', stickers: [], tracks: [recording], createdAt: now, updatedAt: now, ...(visibility ? { visibility } : {}) };
}
function harness(profile: ReturnType<PublicSyncDependencies['profile']> = { username: 'alice', avatar: null, favoriteTape: null }) {
  const calls: string[] = [];
  const publish: PublicSyncDependencies['publish'] = {
    async publishProfile(input) { calls.push(`profile:${input.username}`); return { profile: null }; },
    async publishTape(cassette) { calls.push(`tape:${cassette.id}:${cassette.tracks.map((t) => t.provider).join(',')}`); return { tape: {} as never }; },
    async unpublishTape(id) { calls.push(`untape:${id}`); return { id }; },
  };
  return { calls, sync: createPublicSync({ publish, profile: () => profile }) };
}

test('a public tape publishes the profile, then the whole tape including recordings', async () => {
  const { calls, sync } = harness();
  assert.deepEqual(await sync.sync(snapshotVisibility(tape()), tape('public')), []);
  assert.deepEqual(calls, ['profile:alice', 'tape:tape-1:s3']);
});

test('a tape made private comes down; a tape that was never public sends nothing', async () => {
  const { calls, sync } = harness(null);
  assert.deepEqual(await sync.sync(snapshotVisibility(tape('public')), tape('private')), []);
  assert.deepEqual(await sync.sync(snapshotVisibility(tape()), tape()), []);
  assert.deepEqual(calls, ['untape:tape-1']);
});

test('without a username nothing is published and the listener is told why', async () => {
  const { calls, sync } = harness(null);
  const errors = await sync.sync(snapshotVisibility(tape()), tape('public'));
  assert.deepEqual(calls, []);
  assert.match(errors[0], /username/);
});

test('deleting a public tape takes it down', async () => {
  const { calls, sync } = harness();
  await sync.remove('tape-1', snapshotVisibility(tape()));
  await sync.remove('tape-1', snapshotVisibility(tape('public')));
  assert.deepEqual(calls, ['untape:tape-1']);
});
