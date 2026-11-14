import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { createAccessTokenVerifier, cachedAccessTokenVerifier } from '../src/middleware/cassetteAuth.js';
import { createCassetteCursor } from '../src/services/cassetteCursor.js';
import { readConfig } from '../src/config.js';

const pool = 'us-west-2_OfflineSecurity';
const client = 'offlineclient';
const issuer = `https://cognito-idp.us-west-2.amazonaws.com/${pool}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
function signed(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'offline-security' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: 'owner-a', client_id: client, token_use: 'access', exp: Math.floor(Date.now() / 1000) + 600, ...overrides })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}

test('real Cognito verifier uses local RSA JWKS and requires trusted issuer/client/access use and expiry', async () => {
  const verifier = createAccessTokenVerifier(pool, client);
  verifier.cacheJwks({ keys: [{ kty: 'RSA', n: jwk.n!, e: jwk.e!, kid: 'offline-security', use: 'sig', alg: 'RS256' }] });
  assert.equal((await verifier.verify(signed())).sub, 'owner-a');
  for (const claims of [
    { iss: `${issuer}Other` }, { client_id: 'foreign-client' },
    { token_use: 'id', aud: client }, { exp: 1 }, { exp: undefined }, { exp: 'never' },
  ]) await assert.rejects(verifier.verify(signed(claims)));
  const valid = signed();
  const parts = valid.split('.');
  parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`;
  await assert.rejects(verifier.verify(parts.join('.')));
  assert.equal(cachedAccessTokenVerifier(pool, client), cachedAccessTokenVerifier(pool, client));
});

const secret = 'OFFLINE-TEST-ONLY-012345678901234567890123456789';
const context = 'us-west-2:pool:client:dynamodb:tapes';
test('HMAC cursors bind owner, page size and deployment query context; no caller keys are trusted', () => {
  const cursor = createCassetteCursor(secret, context);
  const token = cursor.encode('owner-a', 25, 'stable-tape-1');
  assert.equal(cursor.decode(token, 'owner-a', 25), 'stable-tape-1');
  assert.throws(() => cursor.decode(token, 'owner-b', 25));
  assert.throws(() => cursor.decode(token, 'owner-a', 26));
  assert.throws(() => createCassetteCursor(secret, `${context}:another-client`).decode(token, 'owner-a', 25));
  for (const malformed of ['not-a-cursor', `${token}extra`, `${token}=`, 'x'.repeat(2049)]) assert.throws(() => cursor.decode(malformed, 'owner-a', 25));
  const [body, signature] = token.split('.');
  const data = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<string, unknown>;
  data.lastId = '../foreign';
  const changed = Buffer.from(JSON.stringify(data)).toString('base64url');
  assert.throws(() => cursor.decode(`${changed}.${signature}`, 'owner-a', 25));
  const correctlySignedBadKey = createHmac('sha256', secret).update(changed).digest('base64url');
  assert.throws(() => cursor.decode(`${changed}.${correctlySignedBadKey}`, 'owner-a', 25));
  assert.throws(() => createCassetteCursor('short', context));
});

test('cassette storage defaults disabled and memory eligibility never follows cloud/deployed flags', () => {
  assert.equal(readConfig({}).cassettes.storageMode, 'disabled');
  assert.equal(readConfig({}).cassettes.localMemoryAllowed, false);
  assert.equal(readConfig({ NODE_ENV: 'development' }).cassettes.localMemoryAllowed, true);
  for (const env of [
    { NODE_ENV: 'production' }, { NODE_ENV: 'test' },
    { NODE_ENV: 'development', AWS_LAMBDA_FUNCTION_NAME: '' },
    { NODE_ENV: 'development', AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' },
    { NODE_ENV: 'development', LAMBDA_TASK_ROOT: '/var/task' },
  ]) assert.equal(readConfig(env).cassettes.localMemoryAllowed, false);
  assert.equal(readConfig({ CASSETTE_STORAGE_MODE: 'typo' }).cassettes.storageMode, 'typo');
});
