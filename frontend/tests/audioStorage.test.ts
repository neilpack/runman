import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAudioStorage, MAX_AUDIO_BYTES, type AudioStorageDependencies } from '../src/audio/audioStorage';

const identity = 'us-west-2:11111111-1111-4111-8111-111111111111';
const blob = () => new Blob(['audio'], { type: 'audio/webm;codecs=opus' });
const input = () => ({ cassetteId: 'cassette-1', data: blob(), source: 'recording' as const });
const key = `audio/${identity}/cassette-1/object-1`;
const reference = () => ({ source: 'recording' as const, objectKey: key, contentType: blob().type, sizeBytes: 5 });
function setup(overrides: Partial<AudioStorageDependencies> = {}) {
  const calls: string[] = [];
  const storage = createAudioStorage({
    identityId: async () => identity,
    randomId: () => 'object-1',
    canPlayType: () => true,
    upload: ({ path, onProgress }) => {
      calls.push(path);
      onProgress?.({ transferredBytes: 5, totalBytes: 5 });
      return { result: Promise.resolve(), cancel() { calls.push('cancel'); } };
    },
    playback: async (path) => {
      calls.push(path);
      return { url: new URL('https://example.com/temporary'), expiresAt: new Date() };
    },
    remove: async (path) => { calls.push(path); },
    ...overrides,
  });
  return { storage, calls };
}

test('file and recording uploads report progress and return only durable references', async () => {
  for (const source of ['upload', 'recording'] as const) {
    const { storage, calls } = setup();
    let transferred = 0;
    const result = await storage.upload({ ...input(), source, onProgress(p) { transferred = p.transferredBytes; } }).result;
    assert.deepEqual(result, { ...reference(), source });
    assert.equal(transferred, 5);
    assert.deepEqual(calls, [key]);
  }
});

test('empty, oversize, unknown MIME and browser-unsupported audio fail before AWS calls', async () => {
  const cases = [
    new Blob([], { type: 'audio/mpeg' }),
    new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/mpeg' }),
    new Blob(['x'], { type: 'text/plain' }),
    new Blob(['x']),
  ];
  for (const data of cases) {
    const { storage, calls } = setup();
    await assert.rejects(storage.upload({ ...input(), data }).result);
    assert.deepEqual(calls, []);
  }
  const { storage, calls } = setup({ canPlayType: () => false });
  await assert.rejects(storage.upload(input()).result, /format/);
  assert.deepEqual(calls, []);
});

test('exactly 25 MB is accepted without conversion', async () => {
  const data = new Blob([new Uint8Array(MAX_AUDIO_BYTES)], { type: 'audio/mpeg' });
  const { storage } = setup({ upload(actual) {
    assert.equal(actual.data, data);
    return { result: Promise.resolve(), cancel() {} };
  } });
  assert.equal((await storage.upload({ ...input(), data }).result).sizeBytes, MAX_AUDIO_BYTES);
});

test('no reference is returned until upload completes; failures propagate and can be retried', async () => {
  let finish!: () => void;
  let attempts = 0;
  const { storage } = setup({ upload: () => ({
    result: ++attempts === 1 ? Promise.reject(new Error('offline')) : new Promise<void>((resolve) => { finish = resolve; }),
    cancel() {},
  }) });
  await assert.rejects(storage.upload(input()).result, /offline/);
  let complete = false;
  const retry = storage.upload(input()).result.then((value) => { complete = true; return value; });
  await Promise.resolve();
  assert.equal(complete, false);
  finish();
  assert.deepEqual(await retry, reference());
});

test('cancel before identity resolution prevents upload', async () => {
  const { storage, calls } = setup();
  const task = storage.upload(input());
  task.cancel();
  await assert.rejects(task.result, { name: 'AbortError' });
  assert.deepEqual(calls, []);
});

test('cancel during transfer reaches SDK and propagates rejection', async () => {
  let rejectUpload!: (error: Error) => void;
  const { storage } = setup({ upload: () => ({
    result: new Promise((_, reject) => { rejectUpload = reject; }),
    cancel() { rejectUpload(new DOMException('cancelled', 'AbortError')); },
  }) });
  const task = storage.upload(input());
  await Promise.resolve();
  task.cancel();
  await assert.rejects(task.result, { name: 'AbortError' });
});

test('playback can resolve a reloaded reference and unused objects can be removed explicitly', async () => {
  const { storage, calls } = setup();
  const reloaded = JSON.parse(JSON.stringify(reference()));
  assert.ok((await storage.playback('cassette-1', reloaded)).url instanceof URL);
  await storage.removeUnused('cassette-1', reloaded);
  assert.deepEqual(calls, [key, key]);
});

test('foreign identities, other cassettes, URLs, and malformed paths never reach storage', async () => {
  for (const objectKey of [key.replace('11111111-', '22222222-'), key.replace('cassette-1', 'cassette-2'),
    'https://example.com/audio', `${key}/extra`, `${key}/../other`, key.replace('object-1', '..')]) {
    const { storage, calls } = setup();
    await assert.rejects(storage.playback('cassette-1', { ...reference(), objectKey }));
    await assert.rejects(storage.removeUnused('cassette-1', { ...reference(), objectKey }));
    assert.deepEqual(calls, []);
  }
});

test('signed-out or invalid identities cannot upload, play, or delete', async () => {
  for (const identityId of [async () => { throw new Error('Sign in'); }, async () => 'user-pool-sub']) {
    const { storage, calls } = setup({ identityId });
    await assert.rejects(storage.upload(input()).result);
    await assert.rejects(storage.playback('cassette-1', reference()));
    await assert.rejects(storage.removeUnused('cassette-1', reference()));
    assert.deepEqual(calls, []);
  }
});

test('invalid cassette IDs cannot create nested or ambiguous keys', async () => {
  for (const cassetteId of ['', '..', 'a/b', 'a%2fb']) {
    const { storage, calls } = setup();
    await assert.rejects(storage.upload({ ...input(), cassetteId }).result);
    assert.deepEqual(calls, []);
  }
});
