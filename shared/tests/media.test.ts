import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEDIA_LIMITS, mediaObjectKey, parseMediaObjectKey, validateCompleteMediaUploadRequest, validateCreateMediaUploadRequest, validateMediaLedger, validateMediaPlaybackRequest, type CreateMediaUploadRequest, type MediaLedger } from '../src/index.js';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const owner = 'owner-legacy_test';
const intent = (): CreateMediaUploadRequest => ({ source: 'recording', contentType: 'audio/webm;codecs=opus', sizeBytes: 12, sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
function pending(): MediaLedger {
  return { ...intent(), schemaVersion: 1, PK: `USER#${owner}`, SK: `MEDIA#${id}`, owner, mediaId: id, objectKey: mediaObjectKey(owner, id), state: 'PENDING', createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-01T00:05:00.000Z' };
}
function ready(): MediaLedger {
  return { ...pending(), state: 'READY', completedAt: '2020-01-01T00:01:00.000Z', versionId: 'opaque.version+id/with=characters' };
}

test('upload intent preserves exact canonical values and returns an independent JSON copy', () => {
  const input = intent();
  const result = validateCreateMediaUploadRequest(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, input);
  assert.notEqual(result.value, input);
  result.value.contentType = 'audio/mpeg';
  assert.equal(input.contentType, 'audio/webm;codecs=opus');
});

test('audio size uses the inclusive 1–25000000 byte boundary and finite safe integers', () => {
  for (const sizeBytes of [1, MEDIA_LIMITS.audioBytes]) assert.equal(validateCreateMediaUploadRequest({ ...intent(), sizeBytes }).ok, true);
  for (const sizeBytes of [0, -1, MEDIA_LIMITS.audioBytes + 1, 1.1, NaN, Infinity, '12']) assert.equal(validateCreateMediaUploadRequest({ ...intent(), sizeBytes }).ok, false);
});

test('checksums require exactly 32 bytes of canonical base64 including zero padding bits', () => {
  const canonical = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('base64');
  assert.equal(validateCreateMediaUploadRequest({ ...intent(), sha256: canonical }).ok, true);
  const alias = `${'A'.repeat(42)}B=`; // Decodes to the same bytes as all-A checksum, but nonzero pad bits.
  assert.deepEqual(Buffer.from(alias, 'base64'), Buffer.from(intent().sha256, 'base64'));
  for (const sha256 of [alias, canonical.slice(0, -1), `${canonical}\n`, Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), 'a'.repeat(64), canonical.replace('=', '_')]) assert.equal(validateCreateMediaUploadRequest({ ...intent(), sha256 }).ok, false);
});

test('MIME validation accepts supported exact lowercase codec syntax and rejects normalization/markup', () => {
  for (const contentType of ['audio/mpeg', 'audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus,vorbis']) assert.equal(validateCreateMediaUploadRequest({ ...intent(), contentType }).ok, true);
  for (const contentType of ['Audio/MPEG', 'audio/webm; codecs=opus', 'audio/webm;codecs=OPUS', 'audio/webm;codecs="opus"', 'audio/webm\r\nx-test: a', 'audio/svg+xml', 'text/html', '<audio>', 'audio/mpeg ']) assert.equal(validateCreateMediaUploadRequest({ ...intent(), contentType }).ok, false);
});

test('all requests reject server-owned fields, unknown fields, binary values and invalid source', () => {
  for (const field of ['owner', 'PK', 'SK', 'objectKey', 'versionId', 'state', 'expiresAt', 'upload', 'fields', 'url', 'token']) {
    assert.equal(validateCreateMediaUploadRequest({ ...intent(), [field]: 'injected' }).ok, false, field);
  }
  for (const source of ['library', 'community', {}, null]) assert.equal(validateCreateMediaUploadRequest({ ...intent(), source }).ok, false);
  for (const input of [new Uint8Array(3), new Date(), new Blob(['a']), [], null, { ...intent(), sha256: new Uint8Array(32) }]) assert.equal(validateCreateMediaUploadRequest(input).ok, false);
});

test('plain JSON boundaries reject inherited/accessor/symbol/undefined input without invoking getters', () => {
  let touched = false;
  const getter = { ...intent() };
  Object.defineProperty(getter, 'sha256', { enumerable: true, get() { touched = true; throw new Error('must not run'); } });
  assert.equal(validateCreateMediaUploadRequest(getter).ok, false);
  assert.equal(touched, false);
  for (const input of [Object.create(intent()), { ...intent(), [Symbol('hidden')]: true }, { ...intent(), source: undefined }, JSON.parse(`{"__proto__":{},"mediaId":"${id}"}`)]) {
    assert.equal(validateCreateMediaUploadRequest(input).ok, false);
  }
  assert.equal(validateCreateMediaUploadRequest(Object.assign(Object.create(null), intent())).ok, true);
});

test('complete/playback requests accept only a canonical server media UUID selector', () => {
  for (const validate of [validateCompleteMediaUploadRequest, validateMediaPlaybackRequest]) {
    assert.equal(validate({ mediaId: id }).ok, true);
    for (const mediaId of ['legacy-id', id.toUpperCase().replace('11111111', 'ABCDEFAB'), id.replace('-4111-', '-5111-'), `../${id}`, '', otherId + '/x']) assert.equal(validate({ mediaId }).ok, false);
    for (const input of [{}, { mediaId: id, objectKey: 'private/key' }, { mediaId: id, owner }, { mediaId: id, upload: { url: 'https://example.com' } }, { mediaId: id, versionId: 'v1' }]) assert.equal(validate(input).ok, false);
  }
});

test('key helpers roundtrip bounded structural owners and reject foreign/public/legacy namespaces', () => {
  let coerced = false;
  const invalidObject = { toString() { coerced = true; return owner; } } as unknown as string;
  assert.throws(() => mediaObjectKey(invalidObject, id));
  assert.throws(() => mediaObjectKey(owner, invalidObject));
  assert.equal(coerced, false);
  assert.deepEqual(parseMediaObjectKey(mediaObjectKey(owner, id)), { owner, mediaId: id });
  assert.ok(mediaObjectKey('a'.repeat(128), id));
  for (const invalid of ['', 'a'.repeat(129), 'owner/foreign', 'owner:identity', '..']) assert.throws(() => mediaObjectKey(invalid, id));
  for (const key of [`public/${owner}/media/${id}`, `audio/us-west-2:11111111-1111-4111-8111-111111111111/tape/${id}`, `https://bucket.example.com/private/${owner}/media/${id}`, `private/${owner}/media/${id}/extra`, `private/${owner}/../${id}`]) assert.equal(parseMediaObjectKey(key), undefined);
});

test('ledger PENDING/READY roundtrip is independent of wall-clock expiry and returns detached copies', () => {
  for (const input of [pending(), ready()]) {
    const result = validateMediaLedger(input);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.deepEqual(result.value, input);
    result.value.objectKey = 'changed';
    assert.equal(input.objectKey, mediaObjectKey(owner, id));
  }
});

test('ledger validates exact owner, key, ID and schema consistency without claiming authentication', () => {
  for (const change of [{ PK: 'USER#foreign' }, { SK: `MEDIA#${otherId}` }, { owner: 'foreign' }, { objectKey: mediaObjectKey('foreign', id) }, { objectKey: mediaObjectKey(owner, otherId) }, { schemaVersion: 2 }, { state: 'DONE' }, { owner: new Date() }]) assert.equal(validateMediaLedger({ ...pending(), ...change }).ok, false);
  for (const field of ['url', 'fields', 'upload', 'token', 'ttl', 'credentials']) assert.equal(validateMediaLedger({ ...ready(), [field]: 'not-ledger-data' }).ok, false);
});

test('ledger state and opaque version invariants reject pending completion fields and unpinned READY', () => {
  for (const change of [{ versionId: 'v1' }, { completedAt: '2020-01-01T00:01:00.000Z' }]) assert.equal(validateMediaLedger({ ...pending(), ...change }).ok, false);
  for (const versionId of ['', ' ', 'null', ' null ', ' v1', 'v1 ', 'v\n1', 'x'.repeat(1025), undefined]) assert.equal(validateMediaLedger({ ...ready(), versionId }).ok, false);
  for (const versionId of ['opaque+/=_-.', 'x'.repeat(1024)]) assert.equal(validateMediaLedger({ ...ready(), versionId }).ok, true);
  const incomplete: Record<string, unknown> = { ...ready() }; delete incomplete.completedAt;
  assert.equal(validateMediaLedger(incomplete).ok, false);
});

test('timestamps enforce canonical ISO and a 1–300s intent window with completion inside it', () => {
  for (const expiresAt of ['2020-01-01T00:00:00.999Z', '2020-01-01T00:05:00.001Z', '2019-12-31T23:59:59.000Z', '2020-02-31T00:00:00.000Z', '2020-01-01T00:05:00Z']) assert.equal(validateMediaLedger({ ...pending(), expiresAt }).ok, false);
  assert.equal(validateMediaLedger({ ...pending(), expiresAt: '2020-01-01T00:00:01.000Z' }).ok, true);
  for (const completedAt of ['2019-12-31T23:59:59.999Z', '2020-01-01T00:05:00.001Z']) assert.equal(validateMediaLedger({ ...ready(), completedAt }).ok, false);
  for (const completedAt of ['2020-01-01T00:00:00.000Z', '2020-01-01T00:05:00.000Z']) assert.equal(validateMediaLedger({ ...ready(), completedAt }).ok, true);
});
