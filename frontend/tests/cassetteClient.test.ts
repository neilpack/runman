import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CassetteDocument } from '@runman/shared';
import { CassetteApiError, createCassetteApi, type CassetteToken } from '../src/api/cassetteClient';

function document(): CassetteDocument {
  return { schemaVersion: 1, revision: 1, createdAt: '2026-11-14T01:00:00.000Z', updatedAt: '2026-11-14T01:00:00.000Z', payload: {
    id: 'tape-1', name: 'Mix', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000',
    shellType: 'solid', penStyle: 'marker', stickers: [], tracks: [],
  } };
}
const access = (sub = 'alice'): CassetteToken => ({ sub, token: 'offline-access-token', expiresAt: Date.now() / 1000 + 600 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('cassette client obtains a fresh access token per request and disables cross-account HTTP caching', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let tokens = 0;
  const api = createCassetteApi({
    baseUrl: 'https://api.example.com', currentOwner: () => 'alice',
    accessToken: async () => ({ ...access(), token: `access-${++tokens}` }),
    fetcher: async (url, init) => { calls.push({ url: String(url), init }); return json({ items: [document()], nextCursor: 'opaque.cursor' }); },
  });
  const first = await api.list('alice', { limit: 25 });
  await api.list('alice', { limit: 25, cursor: first.nextCursor });
  assert.equal(tokens, 2);
  assert.equal(calls[0].url, 'https://api.example.com/api/cassettes?limit=25');
  assert.ok(calls[1].url.includes('cursor=opaque.cursor'));
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), 'Bearer access-2');
  assert.equal(calls[0].init?.cache, 'no-store');
  assert.equal(calls[0].init?.credentials, 'omit');
  assert.equal(calls.some((call) => call.url.includes('alice')), false);
});

test('token-owner mismatch, missing/expired tokens and signed-out accounts never reach the API', async () => {
  let calls = 0;
  for (const token of [null, access('bob'), { ...access(), expiresAt: 1 }]) {
    const api = createCassetteApi({ baseUrl: '', currentOwner: () => 'alice', accessToken: async () => token,
      fetcher: async () => { calls++; return json({ cassette: document() }); } });
    await assert.rejects(api.get('alice', 'tape-1'), { status: 401 });
  }
  const signedOut = createCassetteApi({ baseUrl: '', currentOwner: () => null, accessToken: async () => access(),
    fetcher: async () => { calls++; return json({ cassette: document() }); } });
  await assert.rejects(signedOut.get('alice', 'tape-1'), { status: 401 });
  assert.equal(calls, 0);
});

test('account changes during token refresh and aborted same-account relogin prevent a late request', async () => {
  for (const abort of [false, true]) {
    let owner: string | null = 'alice';
    let calls = 0;
    const pending = deferred<CassetteToken>();
    const controller = new AbortController();
    const api = createCassetteApi({ baseUrl: '', currentOwner: () => owner, accessToken: () => pending.promise,
      fetcher: async () => { calls++; return json({ cassette: document() }); } });
    const request = api.get('alice', 'tape-1', controller.signal);
    if (abort) controller.abort(); else owner = 'bob';
    pending.resolve(access());
    await assert.rejects(request, abort ? { name: 'AbortError' } : { status: 401 });
    assert.equal(calls, 0);
  }
});

test('late server responses cannot be accepted after an account switch', async () => {
  let owner = 'alice';
  const pending = deferred<Response>();
  const entered = deferred<void>();
  const api = createCassetteApi({ baseUrl: '', currentOwner: () => owner, accessToken: async () => access(),
    fetcher: async () => { entered.resolve(); return pending.promise; } });
  const request = api.get('alice', 'tape-1');
  await entered.promise;
  owner = 'bob';
  pending.resolve(json({ cassette: document() }));
  await assert.rejects(request, { status: 401 });
});

test('API errors retain HTTP status and structured validation/conflict details', async () => {
  const details = [{ path: 'cassette.tracks', message: 'Upload audio first.' }];
  for (const status of [401, 409, 422, 503]) {
    const api = createCassetteApi({ baseUrl: '', currentOwner: () => 'alice', accessToken: async () => access(),
      fetcher: async () => json({ error: 'Request refused', details }, status) });
    await assert.rejects(api.save('alice', { cassette: document().payload, expectedRevision: 0 }), (error: unknown) => {
      assert.ok(error instanceof CassetteApiError);
      assert.equal(error.status, status);
      assert.deepEqual(error.details, details);
      return true;
    });
  }
});

test('malformed server documents, wrong IDs/revisions and duplicate page records are rejected', async () => {
  for (const response of [
    { cassette: { ...document(), PK: 'USER#foreign' } },
    { cassette: { ...document(), payload: { ...document().payload, id: 'wrong-id' } } },
    { cassette: { ...document(), revision: 2 } },
  ]) {
    const api = createCassetteApi({ baseUrl: '', currentOwner: () => 'alice', accessToken: async () => access(), fetcher: async () => json(response) });
    await assert.rejects(api.save('alice', { cassette: document().payload, expectedRevision: 0 }), { status: 502 });
  }
  const duplicate = createCassetteApi({ baseUrl: '', currentOwner: () => 'alice', accessToken: async () => access(), fetcher: async () => json({ items: [document(), document()] }) });
  await assert.rejects(duplicate.list('alice'), { status: 502 });
});

test('save and delete send only the conditional request contract', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = createCassetteApi({ baseUrl: '', currentOwner: () => 'alice', accessToken: async () => access(),
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return json(init?.method === 'DELETE' ? { id: 'tape-1', deletedRevision: 1 } : { cassette: document() });
    } });
  const input = { cassette: document().payload, expectedRevision: 0 };
  await api.save('alice', input);
  await api.remove('alice', 'tape-1', 1);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), input);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { expectedRevision: 1 });
  assert.equal(calls[0].url, '/api/cassettes/tape-1');
  await assert.rejects(api.get('alice', '../foreign'), { status: 400 });
  assert.equal(calls.length, 2);
});

test('network failures explain uncertain completion without claiming the save succeeded', async () => {
  const api = createCassetteApi({ baseUrl: '', currentOwner: () => 'alice', accessToken: async () => access(),
    fetcher: async () => { throw new TypeError('Network failure'); } });
  await assert.rejects(api.save('alice', { cassette: document().payload, expectedRevision: 0 }), (error: unknown) => {
    assert.ok(error instanceof CassetteApiError);
    assert.equal(error.status, 0);
    assert.match(error.message, /could not be confirmed/);
    assert.match(error.message, /draft was kept/);
    return true;
  });
});
