import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordAudio, type RecorderHandle, type RecordingDependencies } from '../src/audio/recordAudio';
import { MAX_AUDIO_BYTES } from '../src/audio/audioStorage';

function harness() {
  let releases = 0;
  let stops = 0;
  let selectedType = '';
  const recorder: RecorderHandle = {
    mimeType: 'audio/webm;codecs=opus', state: 'inactive',
    ondataavailable: null, onstop: null, onerror: null,
    start(interval) { assert.equal(interval, 1000); recorder.state = 'recording'; },
    stop() { stops++; recorder.state = 'inactive'; },
  };
  const microphone = {
    release() { releases++; },
    recorder(type: string) { selectedType = type; return recorder; },
  };
  const deps: RecordingDependencies = {
    supports: (type) => type === recorder.mimeType,
    getMicrophone: async () => microphone,
  };
  const controller = new AbortController();
  const emit = (data: Blob) => recorder.ondataavailable?.(Object.assign(new Event('dataavailable'), { data, timecode: 0 }));
  const finish = () => { recorder.state = 'inactive'; recorder.onstop?.(new Event('stop')); };
  return { recorder, microphone, deps, controller, emit, finish,
    counts: () => ({ releases, stops, selectedType }) };
}

test('recording keeps final chunks and actual codec, then releases the microphone', async () => {
  const h = harness();
  const progress: number[] = [];
  const recording = await recordAudio(h.controller.signal, (n) => progress.push(n), h.deps);
  h.emit(new Blob(['first']));
  recording.stop();
  h.emit(new Blob(['last']));
  h.finish();
  const result = await recording.result;
  assert.equal(await result.text(), 'firstlast');
  assert.equal(result.type, h.recorder.mimeType);
  assert.deepEqual(progress, [5, 9]);
  assert.deepEqual(h.counts(), { releases: 1, stops: 1, selectedType: h.recorder.mimeType });
  assert.equal(h.recorder.ondataavailable, null);
});

test('repeated stop is harmless while final data is pending', async () => {
  const h = harness();
  const recording = await recordAudio(h.controller.signal, undefined, h.deps);
  recording.stop(); recording.stop();
  h.emit(new Blob(['x'])); h.finish();
  await recording.result;
  assert.equal(h.counts().stops, 1);
});

test('cancel during recording rejects and releases all microphone resources', async () => {
  const h = harness();
  const recording = await recordAudio(h.controller.signal, undefined, h.deps);
  h.emit(new Blob(['private']));
  const rejected = assert.rejects(recording.result, { name: 'AbortError' });
  h.controller.abort();
  await rejected;
  recording.cancel();
  assert.equal(h.counts().releases, 1);
  assert.equal(h.counts().stops, 1);
});

test('permission cancellation returns immediately and releases a stream granted later', async () => {
  const h = harness();
  let grant!: (value: typeof h.microphone) => void;
  const request = recordAudio(h.controller.signal, undefined, {
    ...h.deps, getMicrophone: () => new Promise((resolve) => { grant = resolve; }),
  });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  h.controller.abort();
  await rejected; // No need to wait for the browser prompt to resolve.
  grant(h.microphone);
  await Promise.resolve();
  assert.equal(h.counts().releases, 1);
  assert.equal(h.counts().selectedType, '');
});

test('denied permission and unsupported recording formats propagate without starting a recorder', async () => {
  const h = harness();
  await assert.rejects(recordAudio(h.controller.signal, undefined, {
    ...h.deps, getMicrophone: async () => { throw new DOMException('denied', 'NotAllowedError'); },
  }), { name: 'NotAllowedError' });
  await assert.rejects(recordAudio(h.controller.signal, undefined, {
    ...h.deps, supports: () => false, getMicrophone: async () => assert.fail('must not prompt'),
  }), /supported audio format/);
});

test('already-aborted request never asks for microphone permission', async () => {
  const h = harness(); h.controller.abort();
  await assert.rejects(recordAudio(h.controller.signal, undefined, {
    ...h.deps, getMicrophone: async () => assert.fail('must not prompt'),
  }), { name: 'AbortError' });
});

test('exceeding 25 MB discards recording and stops the microphone', async () => {
  const h = harness();
  const recording = await recordAudio(h.controller.signal, undefined, h.deps);
  const rejected = assert.rejects(recording.result, /exceeded 25 MB/);
  h.emit(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]));
  await rejected;
  assert.equal(h.counts().releases, 1);
  assert.equal(h.counts().stops, 1);
});

test('empty recordings reject and release the microphone', async () => {
  const h = harness();
  const recording = await recordAudio(h.controller.signal, undefined, h.deps);
  h.finish();
  await assert.rejects(recording.result, /empty/);
  assert.equal(h.counts().releases, 1);
});

test('constructor, start and recorder errors release the microphone', async () => {
  const h = harness();
  await assert.rejects(recordAudio(h.controller.signal, undefined, {
    ...h.deps, getMicrophone: async () => ({ ...h.microphone, recorder() { throw new Error('constructor'); } }),
  }), /constructor/);
  assert.equal(h.counts().releases, 1);

  const start = harness();
  start.recorder.start = () => { throw new Error('start failed'); };
  const recording = await recordAudio(start.controller.signal, undefined, start.deps);
  await assert.rejects(recording.result, /could not start/);
  assert.equal(start.counts().releases, 1);

  const error = harness();
  const running = await recordAudio(error.controller.signal, undefined, error.deps);
  error.recorder.onerror?.(Object.assign(new Event('error'), { message: '', filename: '', lineno: 0, colno: 0, error: undefined }));
  await assert.rejects(running.result, /recording failed/);
  assert.equal(error.counts().releases, 1);
});
