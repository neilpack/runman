import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cassette, StoredAudioReference, Track } from '@runman/shared';
import { createPublicSync, snapshotVisibility, type PublicSyncDependencies } from '../src/api/publicSync';

const now = '2026-11-14T01:00:00.000Z';
const ref = (n: number): StoredAudioReference => ({ source: 'upload', objectKey: `private/alice/media/aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`, contentType: 'audio/mpeg', sizeBytes: 10 });
const own = (id: string, n: number, visibility?: 'public' | 'private'): Track => ({ id, title: `Song ${id}`, artist: 'Me', durationSec: 5, side: 'A', source: 'upload', audioReference: ref(n), ...(visibility ? { visibility } : {}) });
function tape(tracks: Track[], visibility?: 'public' | 'private'): Cassette {
  return { id: 'tape-1', name: 'Mix', shellColor: '#111111', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'clean', stickers: [], tracks, createdAt: now, updatedAt: now, ...(visibility ? { visibility } : {}) };
}
function harness(profile: ReturnType<PublicSyncDependencies['profile']> = { username: 'alice', avatar: null, favoriteTape: null }) {
  const calls: string[] = [];
  const publish: PublicSyncDependencies['publish'] = {
    async publishProfile(input) { calls.push(`profile:${input.username}`); return { profile: null }; },
    async publishSong(input) { calls.push(`song:${input.audio.objectKey.slice(-1)}`); return { song: {} as never }; },
    async unpublishSong(key) { calls.push(`unsong:${key.slice(-1)}`); return { id: key }; },
    async publishTape(cassette) {
      calls.push(`tape:${cassette.id}:${cassette.tracks.length}`);
      return { tape: {} as never };
    },
    async unpublishTape(id) { calls.push(`untape:${id}`); return { id }; },
  };
  return { calls, sync: createPublicSync({ publish, profile: () => profile }) };
}

test('going public publishes the profile, then songs, then the tape', async () => {
  const { calls, sync } = harness();
  const before = snapshotVisibility(tape([own('a', 1), own('b', 2)]));
  const errors = await sync.sync(before, tape([own('a', 1, 'public'), own('b', 2)], 'public'));
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ['profile:alice', 'song:1', 'tape:tape-1:2']);
});

test('made private or removed songs and a private tape come down; nothing needs a profile for that', async () => {
  const { calls, sync } = harness(null);
  const before = snapshotVisibility(tape([own('a', 1, 'public'), own('b', 2, 'public')], 'public'));
  const errors = await sync.sync(before, tape([own('a', 1, 'private')]));
  assert.deepEqual(errors, []);
  assert.deepEqual(calls.sort(), ['unsong:1', 'unsong:2', 'untape:tape-1']);
});

test('without a username nothing is published and the listener is told why', async () => {
  const { calls, sync } = harness(null);
  const errors = await sync.sync(snapshotVisibility(tape([])), tape([own('a', 1, 'public')], 'public'));
  assert.deepEqual(calls, []);
  assert.match(errors[0], /username/);
});

test('songs still uploading are skipped with a message; deleting a tape removes what was live', async () => {
  const { calls, sync } = harness();
  const uploading: Track = { ...own('x', 9, 'public'), audioReference: undefined };
  const errors = await sync.sync(snapshotVisibility(tape([])), tape([uploading]));
  assert.match(errors[0], /finished uploading/);
  assert.deepEqual(calls, ['profile:alice']);
  calls.length = 0;
  await sync.remove('tape-1', snapshotVisibility(tape([own('a', 1, 'public'), own('b', 2)], 'public')));
  assert.deepEqual(calls.sort(), ['unsong:1', 'untape:tape-1']);
});
