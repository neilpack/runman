import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Track } from '@runman/shared';
import { createPlaybackController, type PlaybackUrl } from '../src/audio/playbackController';

const track = (): Track => ({
  id: 'song-1', title: 'Recording', artist: 'Me', durationSec: 30, side: 'A', source: 'recording',
  audioReference: { source: 'recording', objectKey: 'private/object-1', contentType: 'audio/webm', sizeBytes: 5 },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('resume and seek reuse fresh URLs, renew near expiry, and force renewal after media errors', async () => {
  let time = 100_000;
  let calls = 0;
  const controller = createPlaybackController(async () => ({ url: `https://audio.test/${++calls}`, expiresAt: time + 300_000 }), () => time);
  const original = track();
  assert.equal((await controller.resolve('tape', original))?.url, 'https://audio.test/1');
  assert.equal((await controller.resolve('tape', original))?.url, 'https://audio.test/1');
  time += 285_000;
  assert.equal((await controller.resolve('tape', original))?.url, 'https://audio.test/2');
  assert.equal((await controller.resolve('tape', original, { force: true }))?.url, 'https://audio.test/3');
  time += 301_000;
  assert.equal((await controller.resolve('tape', original))?.url, 'https://audio.test/4');
  assert.equal(JSON.stringify(original), JSON.stringify(track()), 'temporary URLs never enter the track');
});

test('reference property order is stable; cassette, replacement object, metadata and public URL changes renew', async () => {
  let calls = 0;
  const controller = createPlaybackController(async () => ({ url: String(++calls) }));
  const first = track();
  await controller.resolve('tape', first);
  const reordered = { ...first, audioReference: { sizeBytes: 5, contentType: 'audio/webm', objectKey: 'private/object-1', source: 'recording' as const } };
  assert.equal((await controller.resolve('tape', reordered))?.url, '1');
  const changed = { ...first, audioReference: { ...first.audioReference!, objectKey: 'private/object-2' } };
  assert.equal((await controller.resolve('tape', changed))?.url, '2');
  assert.equal(controller.isCurrent('tape', first), false);
  assert.equal(controller.isCurrent('tape', changed), true);
  assert.equal((await controller.resolve('other-tape', changed))?.url, '3');
  assert.equal((await controller.resolve('other-tape', { ...changed, audioReference: { ...changed.audioReference, sizeBytes: 6 } }))?.url, '4');
  assert.equal((await controller.resolve('tape', { ...first, audioUrl: 'https://public.test/new' }))?.url, '5');
});

test('unload or account invalidation aborts pending work and drops late success and error', async () => {
  for (const fails of [false, true]) {
    const request = deferred<PlaybackUrl>();
    let signal!: AbortSignal;
    const controller = createPlaybackController(async (_id, _track, abort) => { signal = abort; return request.promise; });
    const result = controller.resolve('tape', track());
    controller.invalidate();
    assert.equal(signal.aborted, true);
    assert.equal(controller.isCurrent('tape', track()), false);
    if (fails) request.reject(new Error('late network error'));
    else request.resolve({ url: 'https://stale.test/private' });
    assert.equal(await result, null);
  }
});

test('new same-ID reference supersedes a slow request even if the resolver ignores cancellation', async () => {
  const old = deferred<PlaybackUrl>();
  let oldSignal!: AbortSignal;
  const controller = createPlaybackController(async (_id, value, signal) => {
    if (value.audioReference?.objectKey === 'private/object-1') { oldSignal = signal; return old.promise; }
    return { url: 'https://current.test/private' };
  });
  const previous = controller.resolve('tape', track());
  const replacement = { ...track(), audioReference: { ...track().audioReference!, objectKey: 'private/object-2' } };
  assert.equal((await controller.resolve('tape', replacement))?.url, 'https://current.test/private');
  assert.equal(oldSignal.aborted, true);
  old.resolve({ url: 'https://stale.test/private' });
  assert.equal(await previous, null);
  assert.equal((await controller.resolve('tape', replacement))?.url, 'https://current.test/private');
});

test('current errors propagate and forced renewal failure cannot restore a broken cache', async () => {
  let fail = false;
  let calls = 0;
  const controller = createPlaybackController(async () => {
    ++calls;
    if (fail) throw new Error('offline');
    return { url: 'https://audio.test/temporary' };
  });
  await controller.resolve('tape', track());
  fail = true;
  await assert.rejects(controller.resolve('tape', track(), { force: true }), /offline/);
  await assert.rejects(controller.resolve('tape', track()), /offline/);
  assert.equal(calls, 3);
  controller.invalidate();
  fail = false;
  await controller.resolve('tape', track());
  assert.equal(calls, 4);
});

test('transport cancellation rejects late resolution while preserving a previously loaded fresh URL', async () => {
  let calls = 0;
  const pending = deferred<PlaybackUrl>();
  const controller = createPlaybackController(async () => ++calls === 1 ? { url: 'https://audio.test/fresh' } : pending.promise);
  const original = track();
  await controller.resolve('tape', original);
  controller.cancelPending();
  assert.equal((await controller.resolve('tape', original))?.url, 'https://audio.test/fresh');
  const renewal = controller.resolve('tape', original, { force: true });
  controller.cancelPending();
  pending.resolve({ url: 'https://late.test/private' });
  assert.equal(await renewal, null);
});
