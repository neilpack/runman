import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cassetteToSaveRequest, mediaObjectKey, type Cassette, type StoredAudioReference } from '@runman/shared';
import { appendTapeRecording, adoptTapeRecording, recordingTimeLeft } from '../src/audio/tapeRecording';
import { draftAudioDuration } from '../src/audio/audioDuration';
import { createAudioStorage } from '../src/audio/audioStorage';
import { createCassetteStore } from '../src/cassettes/store';
import { createEditorSaver } from '../src/cassettes/editorSaver';
import { CassetteApiError, type CassetteApi } from '../src/api/cassetteClient';

function tape(): Cassette { return { id: 'tape', name: 'Test', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'marker', stickers: [], tracks: [], createdAt: '2026-11-14T01:00:00.000Z', updatedAt: '2026-11-14T01:00:00.000Z' }; }
const id = '11111111-1111-4111-8111-111111111111';
const ref: StoredAudioReference = { source: 'recording', objectKey: mediaObjectKey('owner', id), contentType: 'audio/webm;codecs=opus', sizeBytes: 5 };
const metadata = { name: 'Microphone recording', durationSec: 5.5 };

test('a recording without WebM duration metadata can upload, complete, and persist on the selected side', async () => {
  const calls: string[] = [];
  const storage = createAudioStorage({ account: () => ({ owner: 'owner', generation: 1 }), subscribeAccount: () => () => {}, canPlayType: () => true,
    hash: async () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', post: async (_grant, blob) => { calls.push('post'); assert.equal(blob.size, 5); },
    api: {
      createUpload: async (_account, input) => { calls.push('intent'); assert.equal(input.source, 'recording'); return { mediaId: id, upload: { url: 'https://s3.us-west-2.amazonaws.com/private-audio', fields: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() } }; },
      complete: async () => { calls.push('complete'); return { reference: ref }; }, playback: async () => { throw new Error('Unexpected playback'); },
    } });
  const reference = await storage.upload({ cassetteId: 'tape', source: 'recording', data: new Blob(['audio'], { type: ref.contentType }) }).result;
  const durationSec = draftAudioDuration('recording', 5.5, Infinity);
  const cassette = tape(); cassette.tracks = appendTapeRecording(cassette, 'B', reference, { ...metadata, durationSec }, () => 'track');
  assert.equal(cassette.tracks[0]?.side, 'B'); assert.equal(cassette.tracks[0]?.durationSec, 5.5);
  assert.deepEqual(calls, ['intent', 'post', 'complete']);
  assert.equal(cassetteToSaveRequest(cassette, 0).ok, true);
});

test('adoption rechecks current capacity and prevents duplicate tracks on callback retries', () => {
  const cassette = tape(); cassette.tracks = appendTapeRecording(cassette, 'A', ref, metadata, () => 'track');
  assert.equal(recordingTimeLeft(cassette, 'A'), 1794.5); assert.equal(recordingTimeLeft(cassette, 'B'), 1800);
  assert.equal(appendTapeRecording(cassette, 'A', ref, metadata, () => assert.fail('duplicate ID')), cassette.tracks);
  const other = { ...ref, objectKey: mediaObjectKey('owner', '22222222-2222-4222-8222-222222222222') };
  assert.throws(() => appendTapeRecording(cassette, 'A', other, { ...metadata, durationSec: 1795 }, () => 'track-2'), /enough recording time/);
  assert.throws(() => appendTapeRecording(cassette, 'A', other, { ...metadata, durationSec: Infinity }, () => 'track-2'), /duration/);
  assert.throws(() => appendTapeRecording(cassette, 'A', { ...other, source: 'upload' }, metadata, () => 'track-2'), /microphone/);
});

test('late recording adoption cannot modify a new account or a deleted cassette', () => {
  let cassette: Cassette | undefined = tape(); let context = 2; let updates = 0;
  const store = { getSync: () => ({ context, status: 'authenticated' }), get: () => cassette, update: (_id: string, patch: Partial<Cassette>) => { updates++; if (cassette) cassette = { ...cassette, ...patch }; } };
  const target = { context: 1, cassetteId: 'tape', side: 'A' as const };
  assert.throws(() => adoptTapeRecording(store, target, ref, metadata, () => 'track'), /account changed/);
  context = 1; cassette = undefined;
  assert.throws(() => adoptTapeRecording(store, target, ref, metadata, () => 'track'), /no longer available/);
  assert.equal(updates, 0);
});

test('Walkman recording save failure keeps its ready reference and retries without another upload', async () => {
  const time = '2026-11-14T01:00:00.000Z'; let saves = 0;
  const api: CassetteApi = {
    list: async () => ({ items: [] }), get: async () => { throw new Error('Unexpected get'); }, remove: async () => { throw new Error('Unexpected delete'); },
    save: async (_owner, request) => {
      if (++saves === 1) throw new CassetteApiError(503, 'Retry save');
      return { cassette: { schemaVersion: 1, revision: request.expectedRevision + 1, createdAt: time, updatedAt: time, payload: request.cassette } };
    },
  };
  const store = createCassetteStore({ api, namespace: 'recording-test', storage: { getItem: () => null, setItem: () => {} }, newId: () => 'tape-new', now: () => time });
  store.setSession('authenticated', 'owner'); await new Promise<void>((resolve) => setImmediate(resolve));
  const local = store.create(); const context = store.getSync().context;
  adoptTapeRecording(store, { cassetteId: local.id, context, side: 'B' }, ref, metadata, () => 'track');
  const save = createEditorSaver(store, local.id, context);
  assert.equal(await save(), false);
  assert.deepEqual(store.get(local.id)?.tracks[0]?.audioReference, ref);
  assert.equal(await save(), true);
  assert.equal(store.getSync().tapes[local.id]?.dirty, false);
  assert.equal(store.get(local.id)?.tracks[0]?.side, 'B'); assert.equal(saves, 2);
});
