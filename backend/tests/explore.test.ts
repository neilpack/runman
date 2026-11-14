import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import express from 'express';
import type { ListenerProfileResponse, ListenerSearchResponse, PublicSongPage, TrendingSongsResponse } from '@runman/shared';
import { errorHandler, notFound } from '../src/middleware/errorHandler.js';
import { createExploreRouter } from '../src/routes/explore.js';
import { demoProfiles, demoSongs } from '../src/services/exploreDemoData.js';
import {
  createExploreService,
  createS3Source,
  createStaticSource,
  parseProfileManifest,
  parseSongManifest,
  searchSongs,
  trendingSongs,
  type S3Access,
  type SongRecord,
} from '../src/services/exploreService.js';

const NOW = new Date('2026-11-14T12:00:00.000Z');

function song(overrides: Partial<SongRecord> & { id: string }): SongRecord {
  return {
    title: 'Untitled', artist: 'Someone', durationSec: 180, uploaderId: 'u1', uploaderUsername: 'user1',
    addCount: 0, publishedAt: NOW.toISOString(), ...overrides,
  };
}

const manifest = {
  title: 'Neon Rain', artist: 'Mo', durationSec: 214.4, uploaderId: 'user-1', uploaderUsername: 'midnight.mo',
  audioKey: 'public/songs/song-1/audio.mp3', publishedAt: '2026-11-10T00:00:00Z', addCount: 3,
};

test('song manifests are validated before being served', () => {
  const parsed = parseSongManifest('song-1', manifest);
  assert.equal(parsed?.durationSec, 214);
  assert.equal(parsed?.publishedAt, '2026-11-10T00:00:00.000Z');

  for (const audioKey of [
    'audio/us-west-2:abc/cassette/private-file', // someone's private upload
    'public/songs/other-song/audio.mp3', // another song's folder
    'public/songs/song-1/../../audio/x', // traversal
    'public/songs/song-1/song.json', // the manifest itself
  ]) {
    assert.equal(parseSongManifest('song-1', { ...manifest, audioKey }), undefined, audioKey);
  }
  assert.equal(parseSongManifest('song-1', { ...manifest, title: '' }), undefined);
  assert.equal(parseSongManifest('song-1', { ...manifest, uploaderUsername: '<script>' }), undefined);
  assert.equal(parseSongManifest('song-1', { ...manifest, artworkUrl: 'javascript:alert(1)' })?.artworkUrl, undefined);
  assert.equal(parseSongManifest('../x', manifest), undefined);
  assert.equal(parseSongManifest('song-1', [manifest]), undefined);
});

test('profile manifests drop unsafe avatars and malformed tapes but keep the listener', () => {
  const tape = {
    id: 'tape-1', name: 'Mix', shellColor: '#111', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid',
    penStyle: 'marker', trackCount: 3, updatedAt: '2026-11-01T00:00:00Z',
    stickers: [{ id: 's', kind: 'heart', x: 10, y: 10, rotation: 0, scale: 1, color: '#ff0000' }, { id: 'bad', kind: 'heart' }],
  };
  const profile = parseProfileManifest('user-1', { username: 'mo', avatar: 'javascript:alert(1)', favoriteTape: tape });
  assert.equal(profile?.avatar, null);
  assert.equal(profile?.favoriteTape?.stickers.length, 1);

  const cssInjection = parseProfileManifest('user-1', { username: 'mo', favoriteTape: { ...tape, shellColor: 'url(https://x)' } });
  assert.equal(cssInjection?.favoriteTape, null);
  assert.equal(parseProfileManifest('user-1', { userId: 'someone-else', username: 'mo' }), undefined);
});

test('search matches every word across title, artist and uploader, ranking title hits first', () => {
  const songs = [
    song({ id: 'a', title: 'Rainy Day', artist: 'Kim' }),
    song({ id: 'b', title: 'Sunshine', artist: 'Rain Collective' }),
    song({ id: 'c', title: 'Café Noir', artist: 'Tess' }),
    song({ id: 'd', title: 'Other', uploaderUsername: 'rainmaker' }),
  ];
  const name = (s: SongRecord) => s.uploaderUsername;
  assert.deepEqual(searchSongs(songs, 'rain', name).map((s) => s.id), ['a', 'b', 'd']);
  assert.deepEqual(searchSongs(songs, 'cafe', name).map((s) => s.id), ['c']);
  assert.deepEqual(searchSongs(songs, 'rain kim', name).map((s) => s.id), ['a']);
  assert.equal(searchSongs(songs, '', name).length, 4);
});

test('trending returns five songs by global plays instead of adds or release age', () => {
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const songs = [
    song({ id: 'old-hit', playCount: 100, addCount: 1, publishedAt: daysAgo(120) }),
    song({ id: 'fresh', playCount: 20, addCount: 2000, publishedAt: daysAgo(1) }),
    ...['n1', 'n2', 'n3', 'n4', 'n5'].map((id, i) => song({ id, addCount: 0, publishedAt: daysAgo(i) })),
  ];
  const top = trendingSongs(songs, NOW);
  assert.equal(top.length, 5);
  assert.equal(top[0].id, 'old-hit');
  assert.ok(top.findIndex((s) => s.id === 'old-hit') < top.findIndex((s) => s.id === 'fresh'));
});

test('S3 source caches listings, skips bad manifests and never caches failures', async () => {
  let lists = 0;
  let failNext = true;
  const files: Record<string, string> = {
    'public/songs/song-1/song.json': JSON.stringify(manifest),
    'public/songs/song-1/audio.mp3': 'binary',
    'public/songs/broken/song.json': '{not json',
    'public/profiles/user-1.json': JSON.stringify({ username: 'midnight.mo' }),
  };
  const s3: S3Access = {
    async list() {
      lists += 1;
      if (failNext) {
        failNext = false;
        throw new Error('S3 down');
      }
      return Object.keys(files);
    },
    async read(key) {
      return files[key];
    },
    async presign(key, expiresIn) {
      return `https://bucket.example/${key}?expires=${expiresIn}`;
    },
  };
  let clock = 0;
  const source = createS3Source(s3, { ttlMs: 1000, now: () => clock });
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    await assert.rejects(source.snapshot(), /S3 down/);
    const first = await source.snapshot();
    assert.deepEqual(first.songs.map((s) => s.id), ['song-1']);
    assert.equal(first.profiles[0].username, 'midnight.mo');
    await source.snapshot();
    assert.equal(lists, 2, 'second call within the TTL is cached');
    clock = 1000;
    await source.snapshot();
    assert.equal(lists, 3, 'refreshes after the TTL');
  } finally {
    console.warn = warn;
  }

  const service = createExploreService(source, () => NOW);
  assert.equal(await service.audioUrl('song-1'), 'https://bucket.example/public/songs/song-1/audio.mp3?expires=3600');
  assert.equal(await service.audioUrl('missing'), undefined);
});

async function serve(t: TestContext) {
  const service = createExploreService(createStaticSource('demo', { songs: demoSongs(NOW), profiles: demoProfiles(), tapes: [] }), () => NOW);
  const app = express();
  app.use('/api/explore', createExploreRouter(service));
  app.use(notFound);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address() as AddressInfo;
  return async <T>(path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/explore${path}`, { redirect: 'manual' });
    return { status: res.status, body: (await res.json()) as T };
  };
}

test('explore routes: songs, trending, listeners and validation', async (t) => {
  const get = await serve(t);

  const all = await get<PublicSongPage>('/songs?limit=5&offset=5');
  assert.equal(all.status, 200);
  assert.equal(all.body.catalog, 'demo');
  assert.equal(all.body.songs.length, 5);
  assert.equal(all.body.total, demoSongs(NOW).length);

  const found = await get<PublicSongPage>('/songs?q=lofi');
  assert.ok(found.body.songs.length > 0);
  assert.ok(found.body.songs.every((s) => s.uploader.username === 'lofi-lou'));

  const trending = await get<TrendingSongsResponse>('/songs/trending');
  assert.equal(trending.body.songs.length, 5);

  const listeners = await get<ListenerSearchResponse>('/profiles?q=@JUNI');
  assert.deepEqual(listeners.body.profiles.map((p) => p.username), ['juniper_beats']);
  assert.equal(listeners.body.profiles[0].songCount, 2);

  const page = await get<ListenerProfileResponse>('/profiles/Midnight.Mo');
  assert.equal(page.status, 200);
  assert.equal(page.body.profile.favoriteTape?.name, 'Night Drive');
  assert.equal(page.body.songs.length, 3);

  assert.equal((await get('/profiles/nobody-here')).status, 404);
  assert.equal((await get('/songs/demo-neon-rain/audio')).status, 404, 'demo songs have no audio');
  assert.equal((await get('/songs?limit=0')).status, 400);
  assert.equal((await get('/songs?offset=-1')).status, 400);
  assert.equal((await get('/songs?q=a&q=b')).status, 400);
  assert.equal((await get(`/songs?q=${'x'.repeat(201)}`)).status, 400);
});
