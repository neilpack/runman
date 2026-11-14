import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftAudioDuration, readAudioDuration, type DurationDependencies } from '../src/audio/audioDuration';

function harness() {
  let revoked = 0; let resets = 0;
  const audio = { duration: 0, src: '', preload: '', onloadedmetadata: null as ((event: Event) => unknown) | null, onerror: null as ((event: Event | string) => unknown) | null,
    removeAttribute() { audio.src = ''; }, load() { resets++; } };
  const deps: DurationDependencies = { audio: () => audio, objectUrl: () => 'blob:test', revoke: () => { revoked++; } };
  return { audio, deps, counts: () => ({ revoked, resets }) };
}

test('unknown or changed WebM metadata cannot erase the captured recording duration', () => {
  for (const metadata of [Infinity, NaN, 0, 3]) assert.equal(draftAudioDuration('recording', 5.5, metadata), 5.5);
  assert.equal(draftAudioDuration('upload', undefined, 8), 8);
  assert.equal(draftAudioDuration('upload', 5, Infinity), 0);
});

test('file duration lookup cleans up its media and object URL on success', async () => {
  const h = harness(); const result = readAudioDuration(new Blob(['audio']), new AbortController().signal, h.deps);
  h.audio.duration = 2.5; h.audio.onloadedmetadata?.(new Event('loadedmetadata'));
  assert.equal(await result, 2.5); assert.deepEqual(h.counts(), { revoked: 1, resets: 1 });
  assert.equal(h.audio.onloadedmetadata, null); assert.equal(h.audio.onerror, null);
});

test('file lookup cancels on account change/unmount and ignores late metadata', async () => {
  const h = harness(); const abort = new AbortController();
  const result = readAudioDuration(new Blob(['audio']), abort.signal, h.deps);
  const late = h.audio.onloadedmetadata; abort.abort();
  await assert.rejects(result, { name: 'AbortError' });
  h.audio.duration = 10; late?.(new Event('loadedmetadata'));
  assert.deepEqual(h.counts(), { revoked: 1, resets: 1 });
});

test('invalid metadata and stalled file reads reject without leaking object URLs', async (context) => {
  const h = harness(); const result = readAudioDuration(new Blob(['audio']), new AbortController().signal, h.deps);
  h.audio.duration = Infinity; h.audio.onloadedmetadata?.(new Event('loadedmetadata'));
  await assert.rejects(result, /duration/); assert.equal(h.counts().revoked, 1);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = harness(); const pending = readAudioDuration(new Blob(['audio']), new AbortController().signal, stalled.deps);
  const rejected = assert.rejects(pending, /duration/); context.mock.timers.tick(10_000); await rejected;
  assert.equal(stalled.counts().revoked, 1);
});
