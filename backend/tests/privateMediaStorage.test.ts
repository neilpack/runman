import assert from 'node:assert/strict';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mediaObjectKey } from '@runman/shared';
import { createPrivateMediaStorage } from '../src/aws/privateMedia.js';
import type { PendingMedia, ReadyMedia } from '../src/services/mediaStorage.js';

const bucket = 'runman-private-offline';
const id = '11111111-1111-4111-8111-111111111111';
function pending(): PendingMedia {
  const created = Date.now() - 5000;
  return { schemaVersion: 1, PK: 'USER#alice', SK: `MEDIA#${id}`, owner: 'alice', mediaId: id,
    objectKey: mediaObjectKey('alice', id), state: 'PENDING', source: 'upload', contentType: 'audio/mpeg', sizeBytes: 100,
    sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', createdAt: new Date(created).toISOString(), expiresAt: new Date(created + 300000).toISOString() };
}
function ready(): ReadyMedia { const record = pending(); return { ...record, state: 'READY', versionId: 'pinned+/version=', completedAt: record.createdAt }; }
function client(expiration?: Date) {
  let resolutions = 0;
  const value = new S3Client({ region: 'us-west-2', credentials: async () => ({ accessKeyId: `OFFLINE_TEST_${++resolutions}`, secretAccessKey: 'OFFLINE_TEST_SECRET_NOT_REAL', sessionToken: 'OFFLINE_TEST_SESSION', expiration }) });
  return { value, resolutions: () => resolutions };
}

test('private storage construction is offline and S3 versioning checks are lazy and read-only', async () => {
  let calls = 0;
  const credentials = client();
  const storage = createPrivateMediaStorage(bucket, { client: credentials.value, versioning: async command => {
    calls++; assert.equal(command.input.Bucket, bucket); return { Status: 'Enabled', $metadata: {} };
  } });
  assert.equal(calls, 0);
  assert.equal(credentials.resolutions(), 0);
  assert.equal(await storage.versioningEnabled(), true);
  assert.equal(calls, 1);
  const suspended = createPrivateMediaStorage(bucket, { client: credentials.value, versioning: async () => ({ Status: 'Suspended', $metadata: {} }) });
  assert.equal(await suspended.versioningEnabled(), false);
});

test('actual SDK POST policy binds exact private key, MIME, checksum, encryption and byte size', async () => {
  const expiry = new Date(Date.now() + 90_000);
  const credentials = client(expiry);
  const record = pending();
  const storage = createPrivateMediaStorage(bucket, { client: credentials.value, post: async (signer, options) => {
    const resolved = credentials.resolutions();
    const grant = await createPresignedPost(signer, options);
    assert.equal(credentials.resolutions(), resolved, 'signing must not resolve the original provider again');
    assert.ok(grant.fields['X-Amz-Credential'].startsWith(`OFFLINE_TEST_${resolved}/`));
    return grant;
  } });
  const grant = await storage.createUpload(record);
  const policy = JSON.parse(Buffer.from(grant.fields.Policy, 'base64').toString('utf8')) as { expiration: string; conditions: unknown[] };
  assert.equal(new URL(grant.url).origin, 'https://s3.us-west-2.amazonaws.com');
  assert.equal(new URL(grant.url).pathname, `/${bucket}`);
  for (const condition of [{ bucket }, { key: record.objectKey }, { 'Content-Type': record.contentType },
    { 'x-amz-checksum-algorithm': 'SHA256' }, { 'x-amz-checksum-sha256': record.sha256 },
    { 'x-amz-server-side-encryption': 'AES256' }, ['content-length-range', 100, 100]]) {
    assert.ok(policy.conditions.some(value => JSON.stringify(value) === JSON.stringify(condition)), JSON.stringify(condition));
  }
  assert.equal(grant.expiresAt, new Date(policy.expiration).toISOString());
  assert.ok(Date.parse(grant.expiresAt) <= expiry.getTime());
  assert.ok(Date.parse(grant.expiresAt) <= Date.parse(record.expiresAt));
  assert.ok(Date.parse(grant.expiresAt) > Date.now());
  assert.ok(credentials.resolutions() > 0);
  assert.equal(Object.hasOwn(record, 'fields'), false);
});

test('actual SDK playback URL pins the exact version and clips its lifetime to credential expiry', async () => {
  const credentials = client(new Date(Date.now() + 60_000));
  const record = ready();
  const storage = createPrivateMediaStorage(bucket, { client: credentials.value, signGet: async (signer, command, options) => {
    const resolved = credentials.resolutions();
    const url = await getSignedUrl(signer, command, options);
    assert.equal(credentials.resolutions(), resolved, 'signing must reuse its frozen credential snapshot');
    assert.ok(new URL(url).searchParams.get('X-Amz-Credential')!.startsWith(`OFFLINE_TEST_${resolved}/`));
    return url;
  } });
  const grant = await storage.playback(record);
  const url = new URL(grant.url);
  assert.equal(url.origin, 'https://s3.us-west-2.amazonaws.com');
  assert.equal(url.pathname, `/${bucket}/${record.objectKey}`);
  assert.equal(url.searchParams.get('versionId'), record.versionId);
  assert.equal(url.searchParams.get('response-cache-control'), 'no-store');
  assert.equal(url.searchParams.get('response-content-type'), record.contentType);
  assert.ok(Number(url.searchParams.get('X-Amz-Expires')) <= 60);
  assert.ok(credentials.resolutions() > 0);
});

test('HEAD reads are private, version-specific, and request actual checksum metadata', async () => {
  const credentials = client();
  const record = ready();
  const storage = createPrivateMediaStorage(bucket, { client: credentials.value, head: async command => {
    assert.deepEqual(command.input, { Bucket: bucket, Key: record.objectKey, VersionId: record.versionId, ChecksumMode: 'ENABLED' });
    return { VersionId: record.versionId, ContentLength: record.sizeBytes, ContentType: record.contentType, ChecksumSHA256: record.sha256, $metadata: {} };
  } });
  assert.deepEqual(await storage.head(record.objectKey, record.versionId), { versionId: record.versionId, sizeBytes: 100, contentType: 'audio/mpeg', sha256: record.sha256 });
  await assert.rejects(storage.head(`public/songs/${id}/file.mp3`));
  assert.equal(credentials.resolutions(), 0);
});

test('missing objects are distinct from access failures and invalid versions never reach S3', async () => {
  const credentials = client();
  let calls = 0;
  const storage = createPrivateMediaStorage(bucket, { client: credentials.value, head: async () => {
    calls++; throw Object.assign(new Error('missing'), { name: 'NoSuchVersion' });
  } });
  assert.equal(await storage.head(ready().objectKey, 'old-version'), undefined);
  await assert.rejects(storage.head(ready().objectKey, 'null'));
  assert.equal(calls, 1);
  const forbidden = createPrivateMediaStorage(bucket, { client: credentials.value, head: async () => { throw Object.assign(new Error('forbidden'), { name: 'AccessDenied' }); } });
  await assert.rejects(forbidden.head(ready().objectKey), { name: 'AccessDenied' });
});

test('expired credentials and invalid state cannot produce a grant', async () => {
  const credentials = client(new Date(Date.now() - 1000));
  const storage = createPrivateMediaStorage(bucket, { client: credentials.value });
  await assert.rejects(storage.createUpload(pending()));
  await assert.rejects(storage.playback(ready()));
  await assert.rejects(storage.playback(pending() as unknown as ReadyMedia));
  await assert.rejects(storage.createUpload(ready() as unknown as PendingMedia));
});
