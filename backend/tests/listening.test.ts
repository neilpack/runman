import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { TransactWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mediaObjectKey } from '@runman/shared';
import { createListeningService } from '../src/services/listeningService.js';
import { createMemoryListeningRepository, type ListeningSession } from '../src/services/listeningRepository.js';
import { createMemoryPublicCatalogRepository } from '../src/services/publicCatalogRepository.js';
import { createDynamoListeningRepository, type ListeningCommand } from '../src/aws/dynamoListening.js';
import { createCatalogSource, createExploreService } from '../src/services/exploreService.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

const id = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
async function fixture(durationSec = 60) {
  const catalog = createMemoryPublicCatalogRepository(); const repository = createMemoryListeningRepository(); let clock = 1_800_000_000_000;
  await catalog.putSong({ id: 'shared', ownerId: 'alice', uploaderUsername: 'alice', title: 'Shared', artist: 'Artist', durationSec, listed: true, audio: { source: 'upload', objectKey: mediaObjectKey('alice', id), contentType: 'audio/mpeg', sizeBytes: 10 } }, new Date(clock).toISOString());
  const jamendo = async (trackId: string) => ({ id: trackId, name: 'Jamendo song', artistName: 'Artist', duration: durationSec, audioUrl: 'https://audio.example/song.mp3' });
  const service = createListeningService(repository, catalog, { jamendo, clock: () => clock });
  return { catalog, repository, service, jamendo, advance: (ms: number) => { clock += ms; } };
}
test('listening accumulates elapsed time, qualifies at 30 seconds, and retries never double count', async () => {
  const h = await fixture(); await h.service.start('alice', { playId: id, song: { provider: 'jamendo', id: '7' } });
  h.advance(29_000); assert.equal((await h.service.progress('alice', { playId: id, listenedMs: 29_000 })).counted, false);
  h.advance(1000); assert.equal((await h.service.progress('alice', { playId: id, listenedMs: 30_000 })).counted, true);
  await Promise.all([h.service.progress('alice', { playId: id, listenedMs: 30_000 }), h.service.progress('alice', { playId: id, listenedMs: 30_000 })]);
  h.advance(30_000); await h.service.progress('alice', { playId: id, listenedMs: 60_000 });
  assert.deepEqual((await h.repository.listStats()).map((s) => [s.playCount, s.listenedMs]), [[1, 60_000]]);
});
test('global totals combine accounts while their playback ledgers remain isolated', async () => {
  const h = await fixture();
  for (const owner of ['alice', 'bob']) await h.service.start(owner, { playId: id, song: { provider: 'explore', id: 'shared' } });
  h.advance(30_000); for (const owner of ['alice', 'bob']) await h.service.progress(owner, { playId: id, listenedMs: 30_000 });
  assert.equal((await h.repository.listStats())[0]?.playCount, 2);
  await assert.rejects(h.service.progress('charlie', { playId: id, listenedMs: 30_000 }), { status: 404 });
});
test('short completed songs count, instant/forged progress fails, and private media stays out', async () => {
  const h = await fixture(3); await h.service.start('alice', { playId: id, song: { provider: 'explore', id: 'shared' } });
  await assert.rejects(h.service.progress('alice', { playId: id, listenedMs: 3000 }), { status: 400 });
  h.advance(3000); assert.equal((await h.service.progress('alice', { playId: id, listenedMs: 3000 })).counted, true);
  assert.deepEqual(await h.service.start('alice', { playId: id2, song: { provider: 'media', id: id2 } }), { eligible: false });
  assert.equal((await h.repository.listStats()).length, 1);
});
test('strict inputs, immutable playback identity and cumulative progress reject counter injection', async () => {
  const h = await fixture(); await h.service.start('alice', { playId: id, song: { provider: 'jamendo', id: '7' } });
  await assert.rejects(h.service.start('alice', { playId: id, song: { provider: 'explore', id: 'shared' } }), { status: 409 });
  for (const body of [{ playId: id, listenedMs: NaN }, { playId: id, listenedMs: -1 }, { playId: id, listenedMs: 1, owner: 'bob' }, { playId: '../bad', listenedMs: 1 }]) await assert.rejects(h.service.progress('alice', body), { status: 400 });
  await assert.rejects(h.service.start('alice', { playId: id2, song: { provider: 'jamendo', id: 'https://bad.example/' } }), { status: 400 });
});
test('Dynamo progress transaction binds ledger revision and adds only the new global delta', async () => {
  const commands: ListeningCommand[] = [];
  const repo = createDynamoListeningRepository('table', async (command) => { commands.push(command); return {}; });
  const previous: ListeningSession = { owner: 'alice', playId: id, song: { provider: 'jamendo', id: '7', title: 'Song', artist: 'Artist', durationSec: 60 }, createdAt: 1000, revision: 2, listenedMs: 20_000, counted: false };
  assert.equal(await repo.advance(previous, { ...previous, revision: 3, listenedMs: 30_000, counted: true }), true);
  assert.ok(commands[0] instanceof TransactWriteCommand);
  const items = commands[0].input.TransactItems!;
  assert.deepEqual(items[0].Put?.ExpressionAttributeValues, { ':revision': 2 });
  assert.equal(items[1].Update?.ExpressionAttributeValues?.[':plays'], 1); assert.equal(items[1].Update?.ExpressionAttributeValues?.[':ms'], 10_000);
  await repo.listStats(); assert.ok(commands[1] instanceof QueryCommand); assert.match(commands[1].input.KeyConditionExpression!, /PK/);
});
test('Discover ranks verified Jamendo and shared songs by global plays and hides unpublished audio', async () => {
  const h = await fixture();
  await h.service.start('alice', { playId: id, song: { provider: 'jamendo', id: '7' } }); h.advance(30_000); await h.service.progress('alice', { playId: id, listenedMs: 30_000 });
  await h.service.start('alice', { playId: id2, song: { provider: 'explore', id: 'shared' } }); h.advance(30_000); await h.service.progress('alice', { playId: id2, listenedMs: 30_000 });
  await h.catalog.deleteSong('shared', 'alice');
  const source = createCatalogSource(h.catalog, { catalog: 'dynamodb', listeningStats: () => h.repository.listStats(), jamendoAudio: async () => 'https://audio.example/song.mp3' });
  const result = await createExploreService(source).songs({ q: '', limit: 20, offset: 0 });
  assert.equal(result.songs[0]?.id, 'jamendo_7'); assert.equal(result.songs[0]?.provider, 'jamendo'); assert.equal(result.songs[0]?.playCount, 1);
  assert.equal(result.songs.some((song) => song.id === 'shared'), false);
  assert.doesNotMatch(JSON.stringify(result), /objectKey|private\//);
});
test('HTTP listening endpoints authenticate before parsing and update global Discover totals', async (t) => {
  let clock = Date.now();
  const settings = readConfig({ NODE_ENV: 'development', AWS_REGION: 'us-west-2', CASSETTE_STORAGE_MODE: 'memory', COGNITO_USER_POOL_ID: 'us-west-2_Offline', COGNITO_USER_POOL_CLIENT_ID: 'offline', CASSETTE_CURSOR_SECRET: 'offline-secret-with-at-least-32-characters' }).cassettes;
  const listener = createApp({ exploreApi: { settings, verifier: { verify: async () => ({ sub: 'alice' }) }, listeningClock: () => clock, jamendoLookup: async () => ({ id: '7', name: 'Song', artistName: 'Artist', duration: 60, audioUrl: 'https://audio.example/song.mp3' }) } }).listen(0);
  await once(listener, 'listening'); t.after(() => listener.close()); const address = listener.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/explore`;
  const post = (path: string, body: string, signed = true) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signed ? { Authorization: 'Bearer a.b.c' } : {}) }, body });
  assert.equal((await post('/plays/start', '{bad', false)).status, 401);
  assert.equal((await post('/plays/start', '{bad')).status, 400);
  assert.equal((await post('/plays/start', JSON.stringify({ padding: 'x'.repeat(5000) }))).status, 413);
  assert.equal((await post('/plays/start', JSON.stringify({ playId: id, song: { provider: 'jamendo', id: '7' } }))).status, 200);
  clock += 30_000; assert.equal((await post('/plays/progress', JSON.stringify({ playId: id, listenedMs: 30_000 }))).status, 200);
  const page = await (await fetch(url + '/songs')).json() as { songs: { id: string; playCount: number }[] };
  assert.equal(page.songs.find((song) => song.id === 'jamendo_7')?.playCount, 1);
});
