import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import type { CassettePayload } from '@runman/shared';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createAccessTokenVerifier } from '../src/middleware/cassetteAuth.js';

// Generated keys and cached JWKS keep these real-signature tests entirely offline.
const poolId = 'us-west-2_Offline123';
const clientId = 'offlinepublicclient';
const issuer = `https://cognito-idp.us-west-2.amazonaws.com/${poolId}`;
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
assert.ok(jwk.n && jwk.e);

function token(sub = alice, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'offline-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuer, sub, client_id: clientId, token_use: 'access', iat: now, exp: now + 600, ...overrides,
  })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
}

function cassette(id = 'tape-1'): CassettePayload {
  return {
    id, name: 'My tape', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000',
    shellType: 'solid', penStyle: 'marker', stickers: [], sideB: { inkColor: '#abcdef' },
    tracks: [{
      id: 'track-1', source: 'library', provider: 'jamendo', sourceId: '123',
      title: 'A song', artist: 'An artist', durationSec: 90, side: 'A',
    }],
  };
}

async function server(t: TestContext, enabled = true) {
  const verifier = createAccessTokenVerifier(poolId, clientId);
  verifier.cacheJwks({ keys: [{ kty: 'RSA', n: jwk.n!, e: jwk.e!, kid: 'offline-key', use: 'sig', alg: 'RS256' }] });
  const settings = readConfig({
    NODE_ENV: 'development', AWS_REGION: 'us-west-2',
    CASSETTE_STORAGE_MODE: enabled ? 'memory' : 'disabled',
    COGNITO_USER_POOL_ID: poolId, COGNITO_USER_POOL_CLIENT_ID: clientId,
    CASSETTE_CURSOR_SECRET: 'offline-test-only-cursor-secret-012345678901234567890123456789',
  }).cassettes;
  const app = createApp({ cassetteApi: { settings, verifier } });
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    listener.closeAllConnections();
    listener.close((error) => error ? reject(error) : resolve());
  }));
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

function request(base: string, path: string, options: { method?: string; body?: unknown; jwt?: string; raw?: string } = {}) {
  return fetch(`${base}/api/cassettes${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.jwt === '' ? {} : { Authorization: `Bearer ${options.jwt ?? token()}` }),
      ...((options.body !== undefined || options.raw !== undefined) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
}

test('HTTP cassette endpoints require genuinely signed, unexpired Cognito access tokens', async (t) => {
  const base = await server(t);
  for (const jwt of [
    '', 'not-a-jwt', token(alice, { exp: 1 }), token(alice, { client_id: 'another-client' }),
    token(alice, { iss: 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_Another' }),
    token(alice, { token_use: 'id', aud: clientId }), token(alice, { sub: '' }), token(alice, { exp: undefined }),
    token().replace(/\.[^.]+$/, '.Zm9yZ2Vk'),
  ]) {
    const response = await request(base, '', { jwt });
    assert.equal(response.status, 401);
  }
  assert.equal((await request(base, '')).status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('HTTP CRUD isolates owners and rejects stale writes while retaining server creation time', async (t) => {
  const base = await server(t);
  const create = await request(base, '/tape-1', { method: 'PUT', body: { cassette: cassette(), expectedRevision: 0 } });
  assert.equal(create.status, 201);
  const original = (await create.json()).cassette;
  assert.equal(original.revision, 1);
  assert.equal(original.schemaVersion, 1);
  assert.deepEqual(original.payload, cassette());
  assert.equal(Object.hasOwn(original, 'PK'), false);
  assert.equal(Object.hasOwn(original, 'SK'), false);
  assert.equal((await request(base, '/tape-1', { jwt: token(bob) })).status, 404);
  assert.deepEqual((await (await request(base, '', { jwt: token(bob) })).json()).items, []);
  assert.equal((await request(base, '/tape-1', { method: 'PUT', jwt: token(bob), body: { cassette: cassette(), expectedRevision: 1 } })).status, 404);
  assert.equal((await request(base, '/tape-1', { method: 'DELETE', jwt: token(bob), body: { expectedRevision: 1 } })).status, 404);
  assert.equal((await request(base, '/tape-1', { method: 'PUT', body: { cassette: cassette(), expectedRevision: 0 } })).status, 409);

  const changed = { ...cassette(), name: 'Updated tape' };
  const update = await request(base, '/tape-1', { method: 'PUT', body: { cassette: changed, expectedRevision: 1 } });
  assert.equal(update.status, 200);
  const updated = (await update.json()).cassette;
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, original.createdAt);
  assert.ok(updated.updatedAt >= original.updatedAt);
  assert.equal((await request(base, '/tape-1', { method: 'PUT', body: { cassette: cassette(), expectedRevision: 1 } })).status, 409);
  assert.equal((await request(base, '/tape-1', { method: 'DELETE', body: { expectedRevision: 1 } })).status, 409);
  assert.equal((await (await request(base, '/tape-1')).json()).cassette.payload.name, 'Updated tape');
  const deleted = await request(base, '/tape-1', { method: 'DELETE', body: { expectedRevision: 2 } });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id: 'tape-1', deletedRevision: 2 });
  assert.equal((await request(base, '/tape-1')).status, 404);
});

test('HTTP pagination is deterministic and rejects tampered or cross-owner cursors', async (t) => {
  const base = await server(t);
  for (const id of ['gamma', 'alpha', 'beta']) {
    assert.equal((await request(base, `/${id}`, { method: 'PUT', body: { cassette: cassette(id), expectedRevision: 0 } })).status, 201);
  }
  const first = await (await request(base, '?limit=1')).json();
  assert.deepEqual(first.items.map((item: { payload: CassettePayload }) => item.payload.id), ['alpha']);
  assert.equal(typeof first.nextCursor, 'string');
  assert.ok(first.nextCursor.length <= 2048);
  const second = await (await request(base, `?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.deepEqual(second.items.map((item: { payload: CassettePayload }) => item.payload.id), ['beta']);
  const third = await (await request(base, `?limit=1&cursor=${encodeURIComponent(second.nextCursor)}`)).json();
  assert.deepEqual(third.items.map((item: { payload: CassettePayload }) => item.payload.id), ['gamma']);
  const tampered = `${first.nextCursor[0] === 'a' ? 'b' : 'a'}${first.nextCursor.slice(1)}`;
  assert.equal((await request(base, `?limit=1&cursor=${encodeURIComponent(tampered)}`)).status, 400);
  assert.equal((await request(base, `?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`, { jwt: token(bob) })).status, 400);
  for (const query of ['?ownerSub=foreign', '?limit=1&limit=2', '?limit=1.5', '?limit=101', '?cursor=']) {
    assert.equal((await request(base, query)).status, 400, query);
  }
});

test('HTTP rejects client ownership, mismatched IDs and private audio without writing a tape', async (t) => {
  const base = await server(t);
  assert.equal((await request(base, '/different', { method: 'PUT', body: { cassette: cassette(), expectedRevision: 0 } })).status, 400);
  assert.equal((await request(base, '/tape-1', { method: 'PUT', body: { cassette: cassette(), expectedRevision: 0, ownerSub: bob } })).status, 400);
  const audio = cassette();
  audio.tracks = [{
    id: 'private', source: 'recording', provider: 's3', title: 'Recording', artist: '', durationSec: 3, side: 'A',
    audio: { source: 'recording', objectKey: 'audio/someone-else/file.webm', contentType: 'audio/webm', sizeBytes: 123 },
  }];
  const response = await request(base, '/tape-1', { method: 'PUT', body: { cassette: audio, expectedRevision: 0 } });
  assert.ok([400, 422].includes(response.status));
  assert.deepEqual((await (await request(base, '')).json()).items, []);
});

test('HTTP accepts metadata above 100 KiB but returns 400/413 for malformed or oversized JSON', async (t) => {
  const base = await server(t);
  const large = cassette();
  large.tracks = Array.from({ length: 100 }, (_, index) => ({
    ...large.tracks[0]!, id: `track-${index}`, artworkUrl: `https://cdn.example.com/${'a'.repeat(1500)}`,
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 100 * 1024);
  assert.equal((await request(base, '/tape-1', { method: 'PUT', body: { cassette: large, expectedRevision: 0 } })).status, 201);
  assert.equal((await request(base, '/tape-2', { method: 'PUT', raw: '{' })).status, 400);
  assert.equal((await request(base, '/tape-2', { method: 'PUT', raw: JSON.stringify({ padding: 'x'.repeat(350 * 1024) }) })).status, 413);
  assert.equal((await request(base, '/tape-2', { method: 'PUT', raw: '{', jwt: '' })).status, 401);
});

test('disabled cassette storage fails closed while health stays available', async (t) => {
  const base = await server(t, false);
  assert.equal((await request(base, '')).status, 503);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
