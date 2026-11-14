import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { TapeSnapshot } from '@runman/shared';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createAccessTokenVerifier } from '../src/middleware/cassetteAuth.js';
import { ProfileCorrupt, createDynamoProfileRepository, type ProfileDynamoCommand } from '../src/aws/dynamoProfiles.js';

const poolId = 'us-west-2_Offline123';
const clientId = 'offlinepublicclient';
const issuer = `https://cognito-idp.us-west-2.amazonaws.com/${poolId}`;
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const now = '2026-11-14T01:00:00.000Z';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });

function token(sub = alice) {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'offline-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub, client_id: clientId, token_use: 'access', iat, exp: iat + 600 })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
}

function snapshot(): TapeSnapshot {
  return {
    id: 'tape-1', name: 'Favorite', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'clear', penStyle: 'script',
    stickers: [{ id: 's1', kind: 'custom-art1', x: 50, y: 50, rotation: 0, scale: 1, color: '#ff0000' }],
    sideB: { penStyle: 'marker' },
    customStickers: [{ id: 'art1', slot: 0, strokes: [{ color: '#000000', width: 4, points: [10, 10, 90, 90] }] }],
    updatedAt: now, trackCount: 3,
  };
}

async function server(t: TestContext, enabled = true) {
  const verifier = createAccessTokenVerifier(poolId, clientId);
  verifier.cacheJwks({ keys: [{ kty: 'RSA', n: jwk.n!, e: jwk.e!, kid: 'offline-key', use: 'sig', alg: 'RS256' }] });
  const settings = readConfig({
    NODE_ENV: 'development', AWS_REGION: 'us-west-2', CASSETTE_STORAGE_MODE: enabled ? 'memory' : 'disabled',
    COGNITO_USER_POOL_ID: poolId, COGNITO_USER_POOL_CLIENT_ID: clientId,
    CASSETTE_CURSOR_SECRET: 'offline-test-only-cursor-secret-012345678901234567890123456789',
  }).cassettes;
  const listener = createApp({ profileApi: { settings, verifier, clock: () => now } }).listen(0);
  await once(listener, 'listening');
  t.after(() => listener.close());
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  return async (method: string, body?: unknown, sub: string | null = alice) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/profile`, {
      method, headers: { 'Content-Type': 'application/json', ...(sub ? { Authorization: `Bearer ${token(sub)}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
}

test('profile favorite tape saves per owner, clears with null, and rejects bad snapshots', async (t) => {
  const call = await server(t);
  assert.deepEqual(await call('GET'), { status: 200, body: { profile: null } });
  const saved = await call('PUT', { favoriteTape: snapshot() });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { profile: { schemaVersion: 1, updatedAt: now, favoriteTape: snapshot() } });
  assert.deepEqual((await call('GET')).body, saved.body);
  assert.deepEqual((await call('GET', undefined, bob)).body, { profile: null });
  assert.equal((await call('PUT', { favoriteTape: null })).status, 200);
  assert.deepEqual((await call('GET')).body, { profile: { schemaVersion: 1, updatedAt: now, favoriteTape: null } });
  for (const bad of [{}, { favoriteTape: { ...snapshot(), tracks: [] } }, { favoriteTape: { ...snapshot(), shellColor: 'red' } }, { favoriteTape: null, owner: bob }]) {
    assert.equal((await call('PUT', bad)).status, 400, JSON.stringify(bad));
  }
});

test('profile API needs a valid token and is 503 when cassette storage is disabled', async (t) => {
  const call = await server(t);
  assert.equal((await call('GET', undefined, null)).status, 401);
  assert.equal((await call('PUT', { favoriteTape: null }, null)).status, 401);
  const off = await server(t, false);
  assert.equal((await off('GET')).status, 503);
});

test('Dynamo profile item lives beside the cassettes as USER#<sub> / PROFILE and is validated on read', async () => {
  const commands: ProfileDynamoCommand[] = [];
  const document = { schemaVersion: 1 as const, updatedAt: now, favoriteTape: snapshot() };
  const outputs: Record<string, unknown>[] = [{}, { Item: { PK: `USER#${alice}`, SK: 'PROFILE', ...document } }, { Item: { PK: `USER#${alice}`, SK: 'PROFILE', ...document, favoriteTape: { id: 'x' } } }];
  const repository = createDynamoProfileRepository('Tapes', async (command) => { commands.push(command); return outputs.shift()!; });
  await repository.put(alice, document);
  assert.ok(commands[0] instanceof PutCommand);
  assert.deepEqual(commands[0].input.Item, { PK: `USER#${alice}`, SK: 'PROFILE', ...document });
  assert.deepEqual(await repository.get(alice), document);
  assert.ok(commands[1] instanceof GetCommand);
  assert.deepEqual(commands[1].input.Key, { PK: `USER#${alice}`, SK: 'PROFILE' });
  assert.equal(commands[1].input.ConsistentRead, true);
  await assert.rejects(repository.get(alice), ProfileCorrupt);
  await assert.rejects(repository.get('USER#evil'), ProfileCorrupt);
});
