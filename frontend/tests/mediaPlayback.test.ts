import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackController } from '../src/audio/playbackController';
import { MediaPlaybackError, playAudioSource, playbackFailureMessage } from '../src/audio/mediaPlayback';
import type { Track } from '@runman/shared';

class Media extends EventTarget {
  src = '';
  readyState = 0;
  error: { code: number } | null = null;
  loads = 0;
  plays = 0;
  pauses = 0;
  position = 0;
  playResult: () => Promise<void> = () => Promise.resolve();
  get currentTime() { return this.position; }
  set currentTime(value: number) {
    if (!this.readyState) throw new DOMException('No metadata', 'InvalidStateError');
    this.position = value;
  }
  pause() { this.pauses++; }
  load() { this.loads++; this.error = null; this.readyState = 0; this.position = 0; }
  play() {
    this.plays++;
    return this.error ? Promise.reject(new DOMException('Failed source', 'NotSupportedError')) : this.playResult();
  }
  metadata() { this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
}
const signal = () => new AbortController().signal;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('first play and repeated eject/reinsert load the returned URL and seek only after metadata', async () => {
  const media = new Media();
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `https://audio.test/version-pinned?grant=${attempt}`;
    let finished = false;
    const result = playAudioSource(media, url, 12, signal()).then(() => { finished = true; });
    await tick();
    assert.equal(finished, false);
    assert.equal(media.src, url);
    assert.equal(media.position, 0);
    media.metadata(); await result;
    assert.equal(media.position, 12);
    // The deck ejects by clearing src and resetting the same media element.
    media.pause(); media.src = ''; media.load();
  }
  assert.equal(media.plays, 3);
});

test('same-URL playback resets a failed media element instead of reusing its error state', async () => {
  const media = new Media(); media.src = 'https://audio.test/same-grant';
  media.readyState = 1; media.error = { code: 4 };
  const result = playAudioSource(media, media.src, 0, signal());
  assert.equal(media.loads, 1);
  assert.equal(media.error, null);
  media.metadata(); await result;
});

test('a renewed URL is applied even when the track and previous grant are still marked loaded', async () => {
  const media = new Media(); const track = { id: 'clip', source: 'upload', title: 'Clip', artist: '', durationSec: 30, side: 'A' } as Track;
  let requests = 0;
  const urls = createPlaybackController(async () => ({ url: `https://audio.test/${++requests}`, expiresAt: Date.now() + 60_000 }));
  const initial = await urls.resolve('tape', track);
  const first = playAudioSource(media, initial!.url, 0, signal()); media.metadata(); await first;
  // A failed/interrupted renewal removes the URL cache while the selected track
  // and media element can still describe the previously loaded source.
  await urls.resolve('tape', track, { force: true });
  const renewed = await urls.resolve('tape', track);
  assert.equal(urls.isCurrent('tape', track), true);
  const replay = playAudioSource(media, renewed!.url, 3, signal());
  assert.equal(media.src, 'https://audio.test/2');
  media.metadata(); await replay;
  assert.equal(media.position, 3);
});

test('a healthy same-URL resume preserves the element and seeks without another load', async () => {
  const media = new Media(); media.src = 'https://audio.test/healthy'; media.readyState = 1;
  await playAudioSource(media, media.src, 8, signal());
  assert.equal(media.loads, 0); assert.equal(media.position, 8); assert.equal(media.plays, 1);
});

test('ejection cancels pending metadata/play and late events cannot seek the next inserted tape', async () => {
  const media = new Media(); media.playResult = () => new Promise(() => {});
  const abort = new AbortController();
  const pending = playAudioSource(media, 'https://audio.test/old', 25, abort.signal);
  abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
  media.playResult = () => Promise.resolve();
  const next = playAudioSource(media, 'https://audio.test/new', 0, signal());
  media.metadata(); await next;
  assert.equal(media.position, 0);
});

test('promise rejection and native media errors propagate without exposing source URLs', async () => {
  const denied = new Media(); denied.playResult = () => Promise.reject(new DOMException('Private URL must not appear', 'NotAllowedError'));
  await assert.rejects(playAudioSource(denied, 'https://audio.test/private-grant', 0, signal()), { name: 'NotAllowedError' });
  const failed = new Media();
  const result = playAudioSource(failed, 'https://audio.test/private-grant', 0, signal());
  failed.error = { code: 2 }; failed.dispatchEvent(new Event('error'));
  await assert.rejects(result, (error) => error instanceof MediaPlaybackError && error.code === 2 && !error.message.includes('https:'));
});

test('failure messages distinguish policy, network, decoding and authorization without raw diagnostics', () => {
  assert.equal(playbackFailureMessage(new DOMException('secret', 'NotAllowedError')), 'PRESS PLAY TO ALLOW AUDIO');
  assert.equal(playbackFailureMessage(new MediaPlaybackError(2)), 'AUDIO NETWORK ERROR');
  assert.equal(playbackFailureMessage(new MediaPlaybackError(3)), 'AUDIO DECODE ERROR');
  assert.equal(playbackFailureMessage({ status: 401, message: 'secret' }), 'SIGN IN TO PLAY AUDIO');
  assert.equal(playbackFailureMessage({ status: 503 }), 'AUDIO SERVICE UNAVAILABLE');
});
