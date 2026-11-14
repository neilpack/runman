import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { CassettePayload } from '@runman/shared';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createAccessTokenVerifier } from '../src/middleware/cassetteAuth.js';
import { createMemoryMediaRepository } from '../src/services/mediaRepository.js';
import type { MediaObjectMetadata, PrivateMediaStorage } from '../src/services/mediaStorage.js';

const pool = 'us-west-2_OfflineMedia';
const client = 'offlinemediaclient';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
function token(owner = alice) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'offline-media-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: `https://cognito-idp.us-west-2.amazonaws.com/${pool}`, sub: owner,
    client_id: client, token_use: 'access', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}
const intent = { source: 'upload', contentType: 'audio/mpeg', sizeBytes: 100, sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };

async function fixture(t: TestContext, enabled = true) {
  let now = Date.parse('2026-11-14T01:00:00.000Z');
  let serial = 0;
  let reads = 0;
  let versioningChecks = 0;
  const objects = new Map<string, Map<string, MediaObjectMetadata>>();
  const latest = new Map<string, string>();
  const repository = createMemoryMediaRepository();
  const storage: PrivateMediaStorage = {
    versioningEnabled: async () => { versioningChecks++; return true; },
    createUpload: async record => ({ url: 'https://s3.us-west-2.amazonaws.com/offline-private-audio', fields: { key: record.objectKey }, expiresAt: record.expiresAt }),
    head: async (key, version) => { reads++; return objects.get(key)?.get(version ?? latest.get(key) ?? ''); },
    playback: async record => ({ url: `https://s3.us-west-2.amazonaws.com/offline-private-audio/${record.objectKey}?versionId=${encodeURIComponent(record.versionId)}`, expiresAt: new Date(now + 60_000).toISOString() }),
  };
  const env = { NODE_ENV: 'development', AWS_REGION: 'us-west-2', COGNITO_USER_POOL_ID: pool,
    COGNITO_USER_POOL_CLIENT_ID: client, CASSETTES_TABLE: 'offline-table',
    CASSETTE_CURSOR_SECRET: 'OFFLINE-ONLY-CURSOR-SECRET-012345678901234567890', PRIVATE_AUDIO_BUCKET: 'offline-private-audio' };
  const mediaSettings = readConfig({ ...env, MEDIA_STORAGE_MODE: enabled ? 's3' : 'disabled', CASSETTE_STORAGE_MODE: 'dynamodb' }).media;
  const cassetteSettings = readConfig({ ...env, CASSETTE_STORAGE_MODE: 'memory' }).cassettes;
  const verifier = createAccessTokenVerifier(pool, client);
  verifier.cacheJwks({ keys: [{ kty: 'RSA', n: jwk.n!, e: jwk.e!, kid: 'offline-media-key', use: 'sig', alg: 'RS256' }] });
  const app = createApp({ mediaApi: { settings: mediaSettings, repository, storage, verifier,
    clock: () => new Date(now).toISOString(), newId: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}` },
    cassetteApi: { settings: cassetteSettings, verifier } });
  assert.equal(versioningChecks, 0, 'app construction must not call AWS');
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => { listener.closeAllConnections(); listener.close(error => error ? reject(error) : resolve()); }));
  const address = listener.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return { base, repository, reads: () => reads, advance: (milliseconds: number) => { now += milliseconds; },
    upload(key: string, version = 'v1', changes: Partial<MediaObjectMetadata> = {}) {
      const versions = objects.get(key) ?? new Map<string, MediaObjectMetadata>();
      versions.set(version, { versionId: version, sizeBytes: 100, contentType: 'audio/mpeg', sha256: intent.sha256, ...changes });
      objects.set(key, versions); latest.set(key, version);
    },
  };
}
function request(base: string, path: string, body?: unknown, owner: string | null = alice, method = 'POST', raw?: string) {
  return fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Bearer ${token(owner)}` } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
}
function tape(reference: { source: 'upload' | 'recording'; objectKey: string; contentType: string; sizeBytes: number }): CassettePayload {
  return { id: 'audio-tape', name: 'Audio mix', shellColor: '#123456', shellType: 'solid', labelColor: '#ffffff', inkColor: '#000000',
    penStyle: 'marker', stickers: [], tracks: [{ id: 'track-1', title: 'My audio', artist: '', durationSec: 10, side: 'A', source: reference.source, provider: 's3', audio: reference }] };
}

test('media HTTP lifecycle authenticates upload, pins completion, and authorizes cassette Save/read', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.base, '/media/uploads', intent, null)).status, 401);
  const created = await request(f.base, '/media/uploads', intent);
  assert.equal(created.status, 201);
  const upload = await created.json();
  assert.equal(upload.upload.fields.key, `private/${alice}/media/${upload.mediaId}`);
  f.upload(upload.upload.fields.key);
  const complete = await request(f.base, '/media/complete', { mediaId: upload.mediaId });
  assert.equal(complete.status, 200);
  const { reference } = await complete.json();
  const stored = await f.repository.get(alice, upload.mediaId);
  assert.equal(stored?.state, 'READY');
  assert.equal(Object.hasOwn(stored!, 'upload'), false);
  assert.equal(Object.hasOwn(stored!, 'url'), false);
  const saved = await request(f.base, '/cassettes/audio-tape', { cassette: tape(reference), expectedRevision: 0 }, alice, 'PUT');
  assert.equal(saved.status, 201);
  assert.equal((await (await request(f.base, '/cassettes/audio-tape', undefined, alice, 'GET')).json()).cassette.payload.tracks[0].audio.objectKey, reference.objectKey);
  f.upload(reference.objectKey, 'v2');
  f.advance(301_000);
  assert.equal((await request(f.base, '/media/complete', { mediaId: upload.mediaId })).status, 200, 'READY retry survives intent expiry');
  const playback = await (await request(f.base, '/media/playback', { mediaId: upload.mediaId })).json();
  assert.equal(new URL(playback.url).searchParams.get('versionId'), 'v1');
  assert.equal((await f.repository.get(alice, upload.mediaId))?.state, 'READY');
  const list = await request(f.base, '/cassettes', undefined, alice, 'GET');
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items.length, 1);
});

test('foreign media IDs/references are refused before S3 and malformed metadata never overwrites a tape', async t => {
  const f = await fixture(t);
  const upload = await (await request(f.base, '/media/uploads', intent)).json();
  f.upload(upload.upload.fields.key);
  const { reference } = await (await request(f.base, '/media/complete', { mediaId: upload.mediaId })).json();
  const reads = f.reads();
  assert.equal((await request(f.base, '/media/playback', { mediaId: upload.mediaId }, bob)).status, 404);
  assert.equal((await request(f.base, '/media/complete', { mediaId: upload.mediaId }, bob)).status, 404);
  assert.equal((await request(f.base, '/cassettes/audio-tape', { cassette: tape(reference), expectedRevision: 0 }, bob, 'PUT')).status, 422);
  assert.equal(f.reads(), reads);
  assert.equal((await request(f.base, '/cassettes/audio-tape', { cassette: tape({ ...reference, sizeBytes: 101 }), expectedRevision: 0 }, alice, 'PUT')).status, 422);
  assert.equal(f.reads(), reads, 'reference metadata mismatch must fail before S3');
  assert.deepEqual((await (await request(f.base, '/cassettes', undefined, alice, 'GET')).json()).items, []);
});

test('completion refuses missing, mismatched, unversioned and expired pending uploads', async t => {
  const f = await fixture(t);
  const upload = await (await request(f.base, '/media/uploads', intent)).json();
  assert.equal((await request(f.base, '/media/playback', { mediaId: upload.mediaId })).status, 422);
  assert.equal((await request(f.base, '/media/complete', { mediaId: upload.mediaId })).status, 422);
  for (const metadata of [{ sizeBytes: 99 }, { contentType: 'audio/webm' }, { sha256: 'bad' }, { versionId: 'null' }]) {
    f.upload(upload.upload.fields.key, 'bad-version', metadata);
    assert.equal((await request(f.base, '/media/complete', { mediaId: upload.mediaId })).status, 422);
    assert.equal((await f.repository.get(alice, upload.mediaId))?.state, 'PENDING');
  }
  f.advance(301_000);
  assert.equal((await request(f.base, '/media/complete', { mediaId: upload.mediaId })).status, 410);
});

test('media HTTP parser rejects injection/malformed/oversized bodies only after authentication', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.base, '/media/uploads', { ...intent, owner: bob })).status, 400);
  assert.equal((await request(f.base, '/media/complete', { mediaId: '00000000-0000-4000-8000-000000000001', versionId: 'chosen' })).status, 400);
  assert.equal((await request(f.base, '/media/uploads', undefined, alice, 'POST', '{')).status, 400);
  assert.equal((await request(f.base, '/media/uploads', undefined, alice, 'POST', JSON.stringify({ pad: 'x'.repeat(5000) }))).status, 413);
  assert.equal((await request(f.base, '/media/uploads', undefined, null, 'POST', '{')).status, 401);
  assert.equal((await fetch(`${f.base}/api/health`)).status, 200);
});

test('disabled media routes fail closed without breaking library-only cassette saves', async t => {
  const f = await fixture(t, false);
  assert.equal((await request(f.base, '/media/uploads', intent)).status, 503);
  const libraryOnly = { ...tape({ source: 'upload', objectKey: 'unused', contentType: 'audio/mpeg', sizeBytes: 100 }), tracks: [] };
  assert.equal((await request(f.base, '/cassettes/audio-tape', { cassette: libraryOnly, expectedRevision: 0 }, alice, 'PUT')).status, 201);
  assert.equal(f.reads(), 0);
});
