import assert from 'node:assert/strict';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { mediaObjectKey, type CreateMediaUploadRequest } from '@runman/shared';
import { createMediaApi, type MediaAccount } from '../src/api/mediaClient';

const account: MediaAccount = { owner: 'owner-a', generation: 1 };
const id = '11111111-1111-4111-8111-111111111111';
const input: CreateMediaUploadRequest = { source: 'upload', contentType: 'audio/mpeg', sizeBytes: 12, sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
const reference = () => ({ source: input.source, contentType: input.contentType, sizeBytes: input.sizeBytes, objectKey: mediaObjectKey(account.owner, id) });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function setup(fetcher: typeof fetch, currentAccount: () => MediaAccount | null = () => account) {
  return createMediaApi({ baseUrl: '', currentAccount, accessToken: async () => ({ sub: account.owner, token: 'offline-token', expiresAt: Date.now() / 1000 + 600 }), fetcher });
}
async function signedGrant() {
  const fields = { 'Content-Type': input.contentType, 'x-amz-checksum-algorithm': 'SHA256', 'x-amz-checksum-sha256': input.sha256, 'x-amz-server-side-encryption': 'AES256', success_action_status: '204' };
  const bucket = 'offline-private-audio'; const key = reference().objectKey;
  const client = new S3Client({ region: 'us-west-2', forcePathStyle: true, credentials: { accessKeyId: 'OFFLINE_TEST_ONLY', secretAccessKey: 'OFFLINE_TEST_NOT_REAL_CREDENTIALS', sessionToken: 'OFFLINE_TEST_SESSION' } });
  const grant = await createPresignedPost(client, { Bucket: bucket, Key: key, Expires: 60, Fields: fields, Conditions: [{ bucket }, { key }, ['content-length-range', input.sizeBytes, input.sizeBytes], ...Object.entries(fields).map(([key, value]) => ({ [key]: value }))] });
  const policy = JSON.parse(atob(grant.fields.Policy));
  return { mediaId: id, upload: { ...grant, expiresAt: new Date(policy.expiration).toISOString() } };
}

test('client accepts an actual offline SDK presigned POST grant and sends only exact JWT JSON requests', async () => {
  const grant = await signedGrant(); let calls = 0;
  const api = setup(async (url, init) => { calls++; assert.equal(url, '/api/media/uploads'); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer offline-token'); assert.deepEqual(JSON.parse(String(init?.body)), input); assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'omit'); return json(grant); });
  assert.deepEqual(await api.createUpload(account, input), grant); assert.equal(calls, 1);
});

test('foreign keys, non-AWS URLs, wrong signed metadata/policy sizes, expiry and extra server fields fail closed', async () => {
  const original = await signedGrant();
  const cases = [
    { ...original, owner: 'injected' },
    { ...original, upload: { ...original.upload, url: 'https://attacker.example.com/' } },
    { ...original, upload: { ...original.upload, fields: { ...original.upload.fields, key: mediaObjectKey('owner-b', id) } } },
    { ...original, upload: { ...original.upload, fields: { ...original.upload.fields, 'Content-Type': 'audio/wav' } } },
    { ...original, upload: { ...original.upload, expiresAt: new Date(0).toISOString() } },
    { ...original, upload: { ...original.upload, fields: { ...original.upload.fields, unexpected: 'field' } } },
  ];
  const badPolicy = structuredClone(original); const policy = JSON.parse(atob(badPolicy.upload.fields.Policy));
  policy.conditions = policy.conditions.filter((item: unknown) => !(Array.isArray(item) && item[0] === 'content-length-range'));
  badPolicy.upload.fields.Policy = btoa(JSON.stringify(policy)); cases.push(badPolicy);
  for (const value of cases) await assert.rejects(setup(async () => json(value)).createUpload(account, input), { status: 502 });
});

test('account changes while token/fetch/body are pending suppress all stale results including same-owner relogin', async () => {
  const token = deferred<{ sub: string; token: string; expiresAt: number }>(); let active = account; let calls = 0;
  const api = createMediaApi({ baseUrl: '', currentAccount: () => active, accessToken: async () => token.promise, fetcher: async () => { calls++; return json({ reference: reference() }); } });
  const result = api.complete(account, id); active = { ...account, generation: 3 }; token.resolve({ sub: account.owner, token: 'old', expiresAt: Date.now() / 1000 + 100 });
  await assert.rejects(result, { status: 401 }); assert.equal(calls, 0);
  for (const phase of ['fetch', 'body']) {
    const pending = deferred<unknown>(); active = account;
    const next = setup(async () => phase === 'fetch' ? pending.promise as Promise<Response> : { ok: true, json: () => pending.promise } as Response, () => active);
    const request = next.complete(account, id); await new Promise<void>((resolve) => setImmediate(resolve)); active = { ...account, generation: 5 };
    pending.resolve(phase === 'fetch' ? json({ reference: reference() }) : { reference: reference() }); await assert.rejects(request, { status: 401 });
  }
});

test('invalid tokens and malformed complete selectors never reach network; server errors preserve status', async () => {
  let calls = 0;
  for (const access of [null, { sub: 'other', token: 'x', expiresAt: Infinity }, { sub: account.owner, token: 'x', expiresAt: 0 }]) {
    const api = createMediaApi({ baseUrl: '', currentAccount: () => account, accessToken: async () => access, fetcher: async () => { calls++; return json({}); } });
    await assert.rejects(api.complete(account, id), { status: 401 });
  }
  await assert.rejects(setup(async () => { calls++; return json({}); }).complete(account, '../key'), { status: 400 }); assert.equal(calls, 0);
  await assert.rejects(setup(async () => json({ error: 'Upload is incomplete.' }, 422)).complete(account, id), { status: 422 });
});

test('completion rejects injected/private foreign reference fields and playback requires exact version-pinned S3 location', async () => {
  for (const value of [{ ...reference(), objectKey: mediaObjectKey('owner-b', id) }, { ...reference(), url: 'https://example.com' }, { ...reference(), sizeBytes: 0 }]) await assert.rejects(setup(async () => json({ reference: value })).complete(account, id), { status: 502 });
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const url = `https://s3.us-west-2.amazonaws.com/offline-private-audio/${reference().objectKey}?versionId=version-1`;
  assert.equal((await setup(async () => json({ url, expiresAt })).playback(account, id)).url, url);
  for (const bad of [url.replace('versionId=version-1', 'versionId=null'), url.replace(account.owner, 'foreign'), 'https://attacker.example.com/private']) await assert.rejects(setup(async () => json({ url: bad, expiresAt })).playback(account, id), { status: 502 });
});
