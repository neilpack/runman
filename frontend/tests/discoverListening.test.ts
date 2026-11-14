import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicSong, Track } from '@runman/shared';
import { createListeningTracker } from '../src/audio/listeningTracker';
import { createListeningApi } from '../src/api/listeningClient';
import { createCassetteStore } from '../src/cassettes/store';
import { CassetteApiError, type CassetteApi } from '../src/api/cassetteClient';
import { createTapeAdder } from '../src/components/explore/tapeAdder';
import { trackFromPublicSong, tapeFit } from '../src/components/explore/addToTape';
import { createSharedSongApi } from '../src/api/sharedSongClient';

const track: Track = { id: 'track', source: 'library', sourceId: '7', title: 'Song', artist: 'Artist', durationSec: 60, side: 'A' };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function trackerFixture(durationSec = 60) {
  let account: { owner: string; generation: number } | null = { owner: 'alice', generation: 1 }; let onAccount = () => {}; let ids = 0;
  const updates: { id: string; ms: number }[] = []; const starts: string[] = []; let changes = 0;
  const tracker = createListeningTracker({ account: () => account, subscribe: (listener) => { onAccount = listener; return () => {}; }, randomId: () => `play-${++ids}`, changed: () => { changes++; }, api: {
    start: async (_owner, id) => { starts.push(id); return { eligible: true }; },
    progress: async (_owner, id, ms) => { updates.push({ id, ms }); return { counted: ms >= Math.min(30_000, durationSec * 1000), listenedMs: ms }; },
  } });
  tracker.select({ ...track, durationSec });
  return { tracker, updates, starts, changes: () => changes, switch() { account = { owner: 'bob', generation: 2 }; onAccount(); } };
}
test('actual time counts once at 30 seconds and continues accumulating after qualification', async () => {
  const h = trackerFixture(); h.tracker.sample(0, 0, true);
  for (let i = 1; i <= 60; i++) { h.tracker.sample(i * 1000, i, true); await tick(); }
  await h.tracker.flush(); assert.equal(h.changes(), 1); assert.equal(h.updates.at(-1)?.ms, 60_000); assert.equal(h.starts.length, 1);
  h.tracker.dispose();
});
test('pauses, buffering and seeking forward cannot manufacture listening time', async () => {
  const h = trackerFixture(); h.tracker.sample(0, 0, true); h.tracker.sample(1000, 1, true);
  h.tracker.sample(2000, 50, true); // seek, not 49 seconds of audio
  h.tracker.sample(60_000, 50, false); h.tracker.sample(61_000, 50, true); h.tracker.sample(62_000, 51, true);
  await h.tracker.flush(); assert.equal(h.updates.at(-1)?.ms, 2000); assert.equal(h.changes(), 0); h.tracker.dispose();
});
test('short completed songs count once; a replay starts a new session', async () => {
  const h = trackerFixture(3); h.tracker.sample(0, 0, true); h.tracker.sample(2900, 2.9, true); h.tracker.ended(); await tick();
  assert.equal(h.updates.at(-1)?.ms, 3000); assert.equal(h.changes(), 1);
  h.tracker.select({ ...track, durationSec: 3 }); h.tracker.sample(4000, 0, true); h.tracker.sample(7000, 3, true); await h.tracker.flush();
  assert.equal(h.starts.length, 2); assert.notEqual(h.updates[0]?.id, h.updates.at(-1)?.id); h.tracker.dispose();
});
test('account switching discards the previous session and prevents late cross-account reports', async () => {
  const h = trackerFixture(); h.tracker.sample(0, 0, true); h.tracker.sample(1000, 1, true); h.switch(); await h.tracker.flush();
  assert.equal(h.updates.length, 0); h.tracker.dispose();
});
test('listening client checks account generation again after token refresh', async () => {
  let generation = 1; let requests = 0;
  const api = createListeningApi({ baseUrl: '', account: () => ({ owner: 'alice', generation }), token: async () => { generation = 2; return { sub: 'alice', token: 'offline', expiresAt: Date.now() / 1000 + 600 }; }, fetcher: async () => { requests++; return new Response('{}'); } });
  await assert.rejects(api.start({ owner: 'alice', generation: 1 }, 'play', { provider: 'jamendo', id: '7' }, new AbortController().signal), { name: 'AbortError' }); assert.equal(requests, 0);
});

test('shared playback uses authenticated no-store resolution and rejects late results after account changes', async () => {
  let generation = 1; let switchOnFetch = false; let requested = '';
  const client = createSharedSongApi({ baseUrl: 'https://api.example', account: () => ({ owner: 'alice', generation }),
    token: async () => ({ sub: 'alice', token: 'offline-token', expiresAt: Date.now() / 1000 + 60 }),
    fetcher: async (url, init) => {
      requested = String(url); assert.equal(init?.method, 'POST'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'omit');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer offline-token');
      if (switchOnFetch) generation++;
      return new Response(JSON.stringify({ url: 'https://bucket.example/signed' }));
    },
  });
  assert.deepEqual(await client.playback('song', new AbortController().signal, 'saved-tape'), { url: 'https://bucket.example/signed' });
  assert.equal(requested, 'https://api.example/api/explore/songs/song/playback?cassetteId=saved-tape');
  switchOnFetch = true;
  await assert.rejects(client.playback('song', new AbortController().signal), { name: 'AbortError' });
});

test('an unavailable analytics API backs off and never blocks the audio sampling loop', async () => {
  let clock = 0; let calls = 0;
  const tracker = createListeningTracker({ account: () => ({ owner: 'alice', generation: 1 }), subscribe: () => () => {}, randomId: () => 'play', now: () => clock, api: {
    start: async () => { calls++; throw new Error('offline'); }, progress: async () => { throw new Error('Unexpected progress'); },
  } });
  tracker.select(track); await tick();
  for (let i = 0; i <= 20; i++) { tracker.sample(i * 1000, i, true); await tracker.flush(); }
  assert.equal(calls, 1);
  clock = 15_000; await tracker.flush(); assert.equal(calls, 2); tracker.dispose();
});

const song: PublicSong = { id: 'shared', title: 'Shared song', artist: 'Artist', durationSec: 60, uploader: { userId: 'other', username: 'other' }, hasAudio: true, addCount: 0, publishedAt: '2026-11-14T01:00:00.000Z' };
function library() {
  let ids = 0; let failed = false; const time = song.publishedAt; const payloads: unknown[] = [];
  const api: CassetteApi = { list: async () => ({ items: [] }), get: async () => { throw new Error('Unexpected get'); }, remove: async () => { throw new Error('Unexpected delete'); },
    save: async (_owner, input) => { payloads.push(input); if (failed) throw new CassetteApiError(409, 'Cloud conflict'); return { cassette: { schemaVersion: 1, revision: input.expectedRevision + 1, createdAt: time, updatedAt: time, payload: input.cassette } }; } };
  const store = createCassetteStore({ api, namespace: 'discover', storage: { getItem: () => null, setItem: () => {} }, newId: () => `tape-${++ids}`, now: () => time, communityAudioUrl: (id) => `https://api.example/api/explore/songs/${id}/audio` });
  store.setSession('authenticated', 'alice');
  const adder = createTapeAdder(store, { newId: () => `track-${++ids}`, audioUrl: (id) => `https://api.example/api/explore/songs/${id}/audio` });
  return { store, adder, payloads, fail() { failed = true; } };
}
test('Discover creates a named tape with its song on the selected side and saves it', async () => {
  const h = library(); await tick(); const result = await h.adder.add(song, 'B', undefined, 'Road trip');
  assert.equal(result.saved, true); assert.equal(result.name, 'Road trip'); assert.equal(h.store.get(result.cassetteId)?.tracks[0]?.side, 'B'); assert.equal(h.payloads.length, 1);
});
test('Discover updates an existing tape without dropping tracks and retains draft on save conflict', async () => {
  const h = library(); await tick(); const tape = h.store.create();
  const result = await h.adder.add(song, 'A', tape.id); assert.equal(result.saved, true);
  await assert.rejects(h.adder.add(song, 'B', tape.id), /already/);
  h.fail(); const next = await h.adder.add({ ...song, id: 'shared-2' }, 'B', tape.id);
  assert.equal(next.saved, false); assert.match(next.error!, /conflict/); assert.equal(h.store.get(tape.id)?.tracks.length, 2);
});
test('Jamendo identity survives discovery and duplication checks; account changes block an old picker', async () => {
  const jamendo = { ...song, id: 'jamendo_7', provider: 'jamendo' as const, sourceId: '7', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
  const converted = trackFromPublicSong(jamendo, 'A', 'track'); assert.equal(converted.source, 'library'); assert.equal(converted.sourceId, '7');
  const h = library(); await tick(); const tape = h.store.create({ tracks: [converted] }); assert.equal(tapeFit(tape, 'B', jamendo).ok, false);
  h.store.setSession('authenticated', 'bob'); await assert.rejects(h.adder.add(song, 'A'), /account changed/);
});
