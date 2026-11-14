import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaObjectKey, type SaveCassetteRequest, type StoredAudioReference } from '@runman/shared';
import { createMemoryMediaRepository, type MediaRepository } from '../src/services/mediaRepository.js';
import { createMediaService } from '../src/services/mediaService.js';
import type { MediaObjectMetadata, PendingMedia, PrivateMediaStorage, ReadyMedia } from '../src/services/mediaStorage.js';
import { createCassettesService } from '../src/services/cassettesService.js';
import { createMemoryCassetteRepository } from '../src/services/cassetteRepository.js';
import { createCassetteCursor } from '../src/services/cassetteCursor.js';
import { readConfig } from '../src/config.js';
import { createMediaRuntime } from '../src/services/mediaRuntime.js';

const owner = 'owner-a'; const id = '11111111-1111-4111-8111-111111111111';
const start = '2026-11-14T01:00:00.000Z'; const done = '2026-11-14T01:01:00.000Z';
const request = () => ({ source: 'upload' as const, contentType: 'audio/mpeg', sizeBytes: 12, sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
function pending(): PendingMedia { return { ...request(), schemaVersion: 1, state: 'PENDING', PK: `USER#${owner}`, SK: `MEDIA#${id}`, owner, mediaId: id, objectKey: mediaObjectKey(owner, id), createdAt: start, expiresAt: '2026-11-14T01:05:00.000Z' }; }
function ready(): ReadyMedia { return { ...pending(), state: 'READY', completedAt: done, versionId: 'version-1' }; }
const ref = (): StoredAudioReference => ({ ...request(), objectKey: mediaObjectKey(owner, id) });
const metadata = (versionId = 'version-1'): MediaObjectMetadata => ({ ...request(), versionId });
function setup(overrides: Partial<PrivateMediaStorage> = {}, repository: MediaRepository = createMemoryMediaRepository()) {
  let now = start;
  const heads: (string | undefined)[] = [];
  const storage: PrivateMediaStorage = {
    versioningEnabled: async () => true,
    createUpload: async (record) => ({ url: 'https://offline.example.test', fields: { key: record.objectKey }, expiresAt: record.expiresAt }),
    head: async (_key, version) => { heads.push(version); return metadata(version); },
    playback: async (record) => ({ url: `https://offline.example.test/${record.versionId}`, expiresAt: record.expiresAt }), ...overrides,
  };
  return { repository, storage, heads, now: (value: string) => { now = value; }, service: createMediaService(repository, storage, () => now, () => id) };
}

test('create persists only a server-owned PENDING intent and accepts a credential-shortened grant', async () => {
  const state = setup({ createUpload: async () => ({ url: 'https://offline.example.test', fields: { policy: 'transient' }, expiresAt: done }) });
  const output = await state.service.create(owner, request());
  assert.equal(output.mediaId, id);
  assert.equal(output.upload.expiresAt, done);
  const stored = await state.repository.get(owner, id);
  assert.deepEqual(stored, pending());
  assert.equal(Object.hasOwn(stored!, 'upload'), false);
  assert.equal(await state.repository.get('owner-b', id), undefined);
  await assert.rejects(state.service.create(owner, { ...request(), owner: 'owner-b' }), { status: 400 });
});

test('versioning, provider and signing failures never create READY state or fall back', async () => {
  const disabled = setup({ versioningEnabled: async () => false });
  await assert.rejects(disabled.service.create(owner, request()), { status: 503 });
  assert.equal(await disabled.repository.get(owner, id), undefined);
  const failing = setup({ createUpload: async () => { throw new Error('offline'); } });
  await assert.rejects(failing.service.create(owner, request()), { status: 503 });
  assert.equal((await failing.repository.get(owner, id))?.state, 'PENDING');
});

test('complete verifies latest then the captured version; READY retries never read or repin latest', async () => {
  const state = setup(); await state.repository.create(pending()); state.now(done);
  assert.deepEqual(await state.service.complete(owner, { mediaId: id }), { reference: { source: 'upload', contentType: 'audio/mpeg', sizeBytes: 12, objectKey: mediaObjectKey(owner, id) } });
  assert.deepEqual(state.heads, [undefined, 'version-1', 'version-1']);
  state.now('2027-01-01T00:00:00.000Z'); state.heads.length = 0;
  await state.service.complete(owner, { mediaId: id });
  await state.service.playback(owner, { mediaId: id });
  assert.deepEqual(state.heads, ['version-1', 'version-1']);
  assert.equal((await state.repository.get(owner, id) as ReadyMedia).versionId, 'version-1');
});

test('completion rejects missing/null versions and every mismatched object metadata field', async () => {
  for (const changed of [undefined, { ...metadata(), versionId: undefined }, { ...metadata(), versionId: 'null' }, { ...metadata(), sizeBytes: 13 }, { ...metadata(), contentType: 'audio/wav' }, { ...metadata(), sha256: 'different' }]) {
    const state = setup({ head: async () => changed }); await state.repository.create(pending()); state.now(done);
    await assert.rejects(state.service.complete(owner, { mediaId: id }), { status: 422 });
    assert.equal((await state.repository.get(owner, id))?.state, 'PENDING');
  }
});

test('completion refuses expiry both before and after HEAD verification', async () => {
  const expired = setup(); await expired.repository.create(pending()); expired.now('2026-11-14T01:05:00.001Z');
  await assert.rejects(expired.service.complete(owner, { mediaId: id }), { status: 410 });
  assert.deepEqual(expired.heads, []);
  const state = setup({ head: async () => { state.now('2026-11-14T01:05:00.001Z'); return metadata(); } });
  await state.repository.create(pending());
  await assert.rejects(state.service.complete(owner, { mediaId: id }), { status: 410 });
  assert.equal((await state.repository.get(owner, id))?.state, 'PENDING');
});

test('a concurrent finalization winner is retained and verified through its pinned version', async () => {
  const memory = createMemoryMediaRepository(); await memory.create(pending());
  const winner = { ...ready(), versionId: 'winner-version' };
  const repository: MediaRepository = { ...memory, complete: async () => { await memory.complete(winner); return winner; } };
  const state = setup({}, repository); state.now(done);
  await state.service.complete(owner, { mediaId: id });
  assert.deepEqual(state.heads, [undefined, 'version-1', 'winner-version']);
  assert.equal((await memory.get(owner, id) as ReadyMedia).versionId, 'winner-version');
});

test('authorization rejects foreign/missing/PENDING and mismatched references without granting playback', async () => {
  const state = setup();
  await assert.rejects(state.service.authorize(owner, ref()), { status: 422 });
  await state.repository.create(pending());
  await assert.rejects(state.service.authorize('owner-b', ref()), { status: 422 });
  await assert.rejects(state.service.playback('owner-b', { mediaId: id }), { status: 404 });
  await assert.rejects(state.service.authorize(owner, ref()), { status: 422 });
  await state.repository.complete(ready());
  for (const input of [{ ...ref(), source: 'recording' as const }, { ...ref(), sizeBytes: 13 }, { ...ref(), contentType: 'audio/wav' }, { ...ref(), objectKey: 'audio/legacy/file' }]) await assert.rejects(state.service.authorize(owner, input), { status: 422 });
  await state.service.authorize(owner, ref());
  assert.deepEqual(state.heads, ['version-1']);
});

test('cassette save authorizes before write; listing deduplicates references with bounded concurrency', async () => {
  const repository = createMemoryCassetteRepository();
  const cursor = createCassetteCursor('offline-secret-0000000000000000000000', 'offline');
  const body: SaveCassetteRequest = { expectedRevision: 0, cassette: { id: 'tape-1', name: 'Mix', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'marker', stickers: [], tracks: [{ id: 'track-1', title: 'Audio', artist: 'Owner', durationSec: 12, side: 'A', source: 'upload', provider: 's3', audio: { source: 'upload', objectKey: ref().objectKey, contentType: 'audio/mpeg', sizeBytes: 12 } }] } };
  const denying = createCassettesService(repository, cursor, () => start, async () => { throw new Error('denied'); });
  await assert.rejects(denying.save(owner, 'tape-1', body), { status: 503 });
  assert.equal(await repository.get(owner, 'tape-1'), undefined);
  let calls = 0;
  const service = createCassettesService(repository, cursor, () => start, async () => { calls++; });
  await service.save(owner, 'tape-1', body);
  await service.save(owner, 'tape-2', { ...body, cassette: { ...body.cassette, id: 'tape-2' } });
  calls = 0; await service.list(owner, {}); assert.equal(calls, 1);
  await service.remove(owner, 'tape-1', { expectedRevision: 1 }); assert.equal(calls, 1);
});

test('media configuration defaults disabled and refuses memory/public-bucket/invalid trust configuration', () => {
  const env = { MEDIA_STORAGE_MODE: 's3', CASSETTE_STORAGE_MODE: 'dynamodb', AWS_REGION: 'us-west-2', COGNITO_USER_POOL_ID: 'us-west-2_Offline', COGNITO_USER_POOL_CLIENT_ID: 'offlineclient', CASSETTES_TABLE: 'OfflineTapes', PRIVATE_AUDIO_BUCKET: 'offline-private-audio' };
  assert.equal(createMediaRuntime({ settings: readConfig({}).media }), undefined);
  for (const changed of [{ MEDIA_STORAGE_MODE: 'memory' }, { CASSETTE_STORAGE_MODE: 'memory' }, { UPLOADS_BUCKET: 'offline-private-audio' }, { PRIVATE_AUDIO_BUCKET: 'InvalidBucket' }, { COGNITO_USER_POOL_ID: 'us-east-1_Foreign' }, { AWS_REGION: 'eu-west-1' }]) assert.equal(createMediaRuntime({ settings: readConfig({ ...env, ...changed }).media }), undefined);
  const state = setup();
  assert.ok(createMediaRuntime({ settings: readConfig(env).media, repository: state.repository, storage: state.storage }));
});

function privateTape(tapeId: string, prefix: string, count: number): SaveCassetteRequest {
  return { expectedRevision: 0, cassette: { id: tapeId, name: 'Mix', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'marker', stickers: [], tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, title: 'Audio', artist: 'Owner', durationSec: 1, side: 'A', source: 'upload', provider: 's3', audio: { source: 'upload', objectKey: `private/${owner}/media/${prefix}-${index}`, contentType: 'audio/mpeg', sizeBytes: 12 } })) } };
}

test('listing budgets 100 distinct media keys at cassette boundaries and resumes without skipping', async () => {
  const repository = createMemoryCassetteRepository();
  await repository.save(owner, privateTape('tape-a', 'a', 60), start);
  await repository.save(owner, privateTape('tape-b', 'b', 60), start);
  await repository.save(owner, privateTape('tape-c', 'b', 60), start); // Shared owner media counts once.
  let calls = 0;
  const service = createCassettesService(repository, createCassetteCursor('offline-secret-0000000000000000000000', 'budget'), () => start, async () => { calls++; });
  const first = await service.list(owner, {});
  assert.deepEqual(first.items.map((item) => item.payload.id), ['tape-a']);
  assert.equal(calls, 60); assert.ok(first.nextCursor);
  const second = await service.list(owner, { cursor: first.nextCursor });
  assert.deepEqual(second.items.map((item) => item.payload.id), ['tape-b', 'tape-c']);
  assert.equal(calls, 120); assert.equal(second.nextCursor, undefined);
  const altered = privateTape('tape-d', 'b', 1); const track = altered.cassette.tracks[0];
  assert.ok(track.source !== 'library'); track.audio.sizeBytes = 13;
  await repository.save(owner, altered, start);
  calls = 0;
  await assert.rejects(service.list(owner, { cursor: first.nextCursor }), { status: 422 });
  assert.equal(calls, 0); // Conflicting duplicate metadata rejected before I/O.
});

test('authorization stops dequeuing after failure and waits for already active checks to settle', async () => {
  const repository = createMemoryCassetteRepository();
  await repository.save(owner, privateTape('tape-a', 'a', 10), start);
  let calls = 0;
  let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; });
  const service = createCassettesService(repository, createCassetteCursor('offline-secret-0000000000000000000000', 'failure'), () => start, async () => { if (++calls === 1) throw new Error('offline denial'); await active; });
  let settled = false;
  const listing = service.list(owner, {}).finally(() => { settled = true; });
  const rejected = assert.rejects(listing, { status: 503 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 4); assert.equal(settled, false);
  release(); await rejected;
  assert.equal(calls, 4); assert.equal(settled, true);
});
