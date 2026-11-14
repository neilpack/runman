import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mediaObjectKey, type CreateMediaUploadResponse, type StoredAudioReference } from '@runman/shared';
import { canonicalAudioType, createAudioStorage, MAX_AUDIO_BYTES, type AudioStorageDependencies } from '../src/audio/audioStorage';
import { audioSha256, postAudio } from '../src/audio/audioTransport';
import { createMediaContext } from '../src/auth/mediaContextStore';
import type { MediaAccount } from '../src/api/mediaClient';

const id = '11111111-1111-4111-8111-111111111111';
const initial: MediaAccount = { owner: 'owner-a', generation: 1 };
const checksum = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const blob = () => new Blob(['audio'], { type: 'audio/webm; codecs=opus' });
const reference = (): StoredAudioReference => ({ source: 'recording', objectKey: mediaObjectKey(initial.owner, id), contentType: 'audio/webm;codecs=opus', sizeBytes: 5 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup(overrides: Partial<AudioStorageDependencies> = {}) {
  let account: MediaAccount | null = initial;
  const listeners = new Set<() => void>(); const calls: string[] = [];
  const dependencies: AudioStorageDependencies = {
    account: () => account, subscribeAccount: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, canPlayType: () => true,
    hash: async () => { calls.push('hash'); return checksum; },
    api: {
      createUpload: async (_account, input) => { calls.push('intent'); assert.equal(input.contentType, 'audio/webm;codecs=opus'); return { mediaId: id, upload: { url: 'https://s3.us-west-2.amazonaws.com/offline-bucket', fields: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() } }; },
      complete: async () => { calls.push('complete'); return { reference: reference() }; },
      playback: async () => { calls.push('playback'); return { url: 'https://s3.us-west-2.amazonaws.com/offline-bucket/private', expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
    },
    post: async (_grant, data, _signal, progress) => { calls.push('post'); assert.equal(data.size, 5); progress?.({ transferredBytes: 5 }); }, ...overrides,
  };
  return { dependencies, calls, storage: createAudioStorage(dependencies), switch(value: MediaAccount | null) { account = value; listeners.forEach((listener) => listener()); } };
}
const upload = (state: ReturnType<typeof setup>) => state.storage.upload({ cassetteId: 'tape-1', data: blob(), source: 'recording' });

test('uploads canonical metadata and original bytes, returning only a verified matching durable reference', async () => {
  const state = setup(); let progress = 0;
  const result = await state.storage.upload({ cassetteId: 'tape-1', data: blob(), source: 'recording', onProgress: (value) => { progress = value.transferredBytes; } }).result;
  assert.deepEqual(result, reference()); assert.equal(progress, 5);
  assert.deepEqual(state.calls, ['hash', 'intent', 'post', 'complete']);
  assert.equal(Object.hasOwn(state.storage, 'removeUnused'), false);
  assert.equal(canonicalAudioType(' Audio/WEBM ; codecs = OPUS , VORBIS '), 'audio/webm;codecs=opus,vorbis');
  assert.throws(() => canonicalAudioType('audio/webm;\ncodecs=opus'));
});

test('size, MIME and browser playback checks fail before hashing or API calls', async () => {
  for (const data of [new Blob([]), new Blob(['a'], { type: 'text/html' }), new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/mpeg' })]) {
    const state = setup(); await assert.rejects(state.storage.upload({ cassetteId: 'tape-1', data, source: 'upload' }).result); assert.deepEqual(state.calls, []);
  }
  const state = setup({ canPlayType: () => false }); await assert.rejects(upload(state).result); assert.deepEqual(state.calls, []);
});

test('cancel during hash or transfer suppresses completion and later progress', async () => {
  const hash = deferred<string>(); const state = setup({ hash: async () => hash.promise });
  const task = upload(state); task.cancel(); hash.resolve(checksum);
  await assert.rejects(task.result, { name: 'AbortError' }); assert.deepEqual(state.calls, []);
  const post = deferred<void>(); let signal: AbortSignal | undefined;
  const transfer = setup({ post: async (_grant, _data, passed) => { signal = passed; await post.promise; } });
  const second = upload(transfer); await tick(); second.cancel();
  assert.equal(signal?.aborted, true); post.resolve();
  await assert.rejects(second.result, { name: 'AbortError' }); assert.equal(transfer.calls.includes('complete'), false);
});

test('completion failure retries the same media ID without another upload', async () => {
  const state = setup(); let count = 0;
  state.dependencies.api.complete = async (_account, mediaId) => { assert.equal(mediaId, id); if (++count === 1) throw new Error('offline'); return { reference: reference() }; };
  const task = upload(state); await assert.rejects(task.result, /offline/);
  assert.equal(task.canRetryCompletion(), true);
  assert.deepEqual(await task.retryCompletion(), reference());
  assert.deepEqual(state.calls, ['hash', 'intent', 'post']); assert.equal(count, 2);
});

test('expired or rejected completion permits a fresh upload while retaining the original clip', async () => {
  const state = setup();
  state.dependencies.api.complete = async () => { throw Object.assign(new Error('Intent expired'), { status: 410 }); };
  const task = upload(state); await assert.rejects(task.result, { status: 410 });
  assert.equal(task.canRetryCompletion(), false);
  await assert.rejects(task.retryCompletion(), { name: 'AbortError' });
  state.dependencies.api.complete = async () => ({ reference: reference() });
  assert.deepEqual(await upload(state).result, reference());
  assert.equal(state.calls.filter((call) => call === 'intent').length, 2);
});

test('account generation change aborts completion and same-owner relogin cannot receive stale data', async () => {
  const complete = deferred<{ reference: StoredAudioReference }>(); const state = setup();
  let signal: AbortSignal | undefined;
  state.dependencies.api.complete = async (_account, _id, passed) => { signal = passed; return complete.promise; };
  const task = upload(state); await tick(); state.switch(null); state.switch({ ...initial, generation: 3 });
  assert.equal(signal?.aborted, true); complete.resolve({ reference: reference() });
  await assert.rejects(task.result, { name: 'AbortError' });
  assert.equal(task.canRetryCompletion(), false); await assert.rejects(task.retryCompletion(), { name: 'AbortError' });
});

test('cancel during completion retains a same-account verification retry but never auto-adopts it', async () => {
  const complete = deferred<{ reference: StoredAudioReference }>(); const state = setup(); let attempts = 0;
  state.dependencies.api.complete = async () => ++attempts === 1 ? complete.promise : { reference: reference() };
  const task = upload(state); await tick(); task.cancel(); complete.resolve({ reference: reference() });
  await assert.rejects(task.result, { name: 'AbortError' });
  assert.equal(task.canRetryCompletion(), true); assert.deepEqual(await task.retryCompletion(), reference());
});

test('verification retry after cancellation re-subscribes and aborts if the account changes', async () => {
  const first = deferred<{ reference: StoredAudioReference }>(); const second = deferred<{ reference: StoredAudioReference }>();
  const state = setup(); let attempts = 0; let signal: AbortSignal | undefined;
  state.dependencies.api.complete = async (_account, _id, passed) => { signal = passed; return ++attempts === 1 ? first.promise : second.promise; };
  const task = upload(state); await tick(); task.cancel(); first.resolve({ reference: reference() }); await assert.rejects(task.result, { name: 'AbortError' });
  const retry = task.retryCompletion(); state.switch(null); assert.equal(signal?.aborted, true);
  second.resolve({ reference: reference() }); await assert.rejects(retry, { name: 'AbortError' });
});

test('foreign or mismatched completion references fail; same-owner tape copies may renew playback', async () => {
  const state = setup(); state.dependencies.api.complete = async () => ({ reference: { ...reference(), sizeBytes: 6 } });
  await assert.rejects(upload(state).result, { status: 502 });
  await state.storage.playback('different-tape-copy', reference());
  await assert.rejects(state.storage.playback('tape-1', { ...reference(), objectKey: mediaObjectKey('owner-b', id) }));
  assert.equal(state.calls.filter((call) => call === 'playback').length, 1);
});

test('private playback cancellation/account changes suppress a late URL', async () => {
  const pending = deferred<{ url: string; expiresAt: string }>(); const state = setup();
  state.dependencies.api.playback = async () => pending.promise;
  const playing = state.storage.playback('tape-1', reference()); state.switch(null);
  pending.resolve({ url: 'https://s3.us-west-2.amazonaws.com/offline-bucket/private', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await assert.rejects(playing, { name: 'AbortError' });
});

test('WebCrypto hashes the original bytes into canonical SHA-256 base64', async () => {
  const input = blob(); assert.equal(await audioSha256(input), createHash('sha256').update(Buffer.from(await input.arrayBuffer())).digest('base64'));
});

test('XHR appends file last, sends no app headers/credentials, reports progress and aborts', async () => {
  let form: FormData | undefined; let headers = 0; let aborted = 0;
  const xhr = { withCredentials: true, timeout: 0, status: 204, upload: { onprogress: undefined as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | undefined }, onload: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined, ontimeout: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined,
    open(method: string, url: string) { assert.equal(method, 'POST'); assert.equal(url, 'https://s3.us-west-2.amazonaws.com/offline-bucket'); }, setRequestHeader() { headers++; }, send(value: FormData) { form = value; }, abort() { aborted++; xhr.onabort?.(); } };
  const grant: CreateMediaUploadResponse['upload'] = { url: 'https://s3.us-west-2.amazonaws.com/offline-bucket', fields: { key: 'private/key', Policy: 'transient' }, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const controller = new AbortController(); let transferred = 0;
  const request = postAudio(grant, blob(), controller.signal, (value) => { transferred = value.transferredBytes; }, () => xhr as unknown as XMLHttpRequest);
  assert.deepEqual([...form!.keys()], ['key', 'Policy', 'file']); assert.ok(form!.get('file') instanceof Blob);
  assert.equal(xhr.withCredentials, false); assert.equal(headers, 0);
  xhr.upload.onprogress?.({ loaded: 4, total: 5, lengthComputable: true }); assert.equal(transferred, 4);
  xhr.onload?.(); await request;
  const second = postAudio(grant, blob(), controller.signal, undefined, () => xhr as unknown as XMLHttpRequest);
  controller.abort(); await assert.rejects(second, { name: 'AbortError' }); assert.equal(aborted, 1);
});

test('context generation survives passive refresh and changes for signout/same-owner relogin', () => {
  let snapshot = { status: 'signedIn', user: { userId: 'owner-a' } as { userId: string } | null }; let notify = () => {};
  const context = createMediaContext({ getSnapshot: () => snapshot, subscribe(listener) { notify = listener; return () => {}; } });
  const first = context.account(); let changes = 0; context.subscribe(() => { changes++; });
  notify(); assert.deepEqual(context.account(), first); assert.equal(changes, 0);
  snapshot = { status: 'signedOut', user: null }; notify(); assert.equal(context.account(), null);
  snapshot = { status: 'signedIn', user: { userId: 'owner-a' } }; notify();
  assert.ok(context.account()!.generation > first!.generation); assert.equal(changes, 2);
});
