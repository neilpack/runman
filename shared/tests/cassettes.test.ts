import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cassette, CassetteDocument, CassettePayload, CassetteValidationResult, SaveCassetteRequest, StoredAudioReference } from '../src/index.js';
import { CASSETTE_LIMITS, cassetteFromDocument, cassetteFromPublicTape, sanitizeCustomStickers, cassetteToSaveRequest, validateCassetteDocument, validateDeleteCassetteRequest, validateListCassettesRequest, validateSaveCassetteRequest } from '../src/index.js';

const timestamp = '2026-11-14T01:00:00.000Z';
function tape(): Cassette {
  return {
    id: 'legacyk2026', name: 'A mix 🎵', shellColor: '#123456', labelColor: '#fff6ea', inkColor: '#123', shellType: 'retro', penStyle: 'script',
    stickers: [{ id: 'same-per-side', kind: 'reicon-new-icon', x: 10.5, y: 80, rotation: -180, scale: 2.5, color: '#abcdef' }],
    sideB: { inkColor: '#ffffffff', stickers: [{ id: 'same-per-side', kind: 'another-icon', x: 0, y: 100, rotation: 360, scale: 0.1, color: '#123456' }] },
    tracks: [
      { id: 'track-b', source: 'library', sourceId: '123', title: 'B first', artist: 'Artist', durationSec: 42.5, side: 'B', audioUrl: 'https://storage.jamendo.com/music.mp3?trackid=123', artworkUrl: 'https://cdn.example.com/image.jpg', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/' },
      { id: '22222222-2222-4222-8222-222222222222', source: 'library', sourceId: '456', title: 'A second', artist: '', durationSec: 0, side: 'A' },
    ], createdAt: timestamp, updatedAt: timestamp,
  };
}
function ok<T>(result: CassetteValidationResult<T>): T {
  if (!result.ok) assert.fail(JSON.stringify(result.issues));
  return result.value;
}
function invalid(result: CassetteValidationResult<unknown>, path: string) {
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.path.includes(path)), JSON.stringify(result.issues));
}
function save(): SaveCassetteRequest { return ok(cassetteToSaveRequest(tape(), 0)); }
function document(payload: CassettePayload): CassetteDocument {
  return { schemaVersion: 1, revision: 1, createdAt: timestamp, updatedAt: timestamp, payload };
}
function freeze(value: unknown) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
}
const reference: StoredAudioReference = { source: 'recording', objectKey: 'audio/owner/cassette/file.webm', contentType: 'audio/webm;codecs=opus', sizeBytes: 120 };

test('full visuals and ordered tracks round-trip without mutation, timestamps are server metadata', () => {
  const local = tape();
  freeze(local);
  const saved = ok(cassetteToSaveRequest(local, 0));
  assert.equal('createdAt' in saved.cassette, false);
  assert.deepEqual(saved.cassette.tracks.map((track) => track.id), local.tracks.map((track) => track.id));
  const stored = document(saved.cassette);
  freeze(stored);
  const restored = ok(cassetteFromDocument(stored));
  assert.deepEqual(restored.cassette, local);
  restored.cassette.name = 'changed';
  assert.equal(stored.payload.name, local.name);
});

test('side B absent, empty, partial, and explicit empty stickers preserve exact inheritance representation', () => {
  for (const sideB of [undefined, {}, { penStyle: 'clean' as const }, { stickers: [] }]) {
    const local = tape();
    if (sideB === undefined) delete local.sideB; else local.sideB = sideB;
    const saved = ok(cassetteToSaveRequest(local, 3));
    const restored = ok(cassetteFromDocument(document(saved.cassette))).cassette;
    assert.deepEqual(restored.sideB, sideB);
    assert.equal(Object.hasOwn(restored, 'sideB'), sideB !== undefined);
  }
});

test('Jamendo metadata can omit playback URL, but legacy tracks without a source ID are unsaveable', () => {
  const local = tape();
  delete local.tracks[0]!.audioUrl;
  assert.equal(cassetteToSaveRequest(local, 0).ok, true);
  delete local.tracks[0]!.sourceId;
  invalid(cassetteToSaveRequest(local, 0), 'sourceId');
  assert.equal(local.tracks.length, 2);
});

test('known Creative Commons HTTP license snapshots are upgraded without broad HTTP playback acceptance', () => {
  const local = tape();
  local.tracks[0]!.licenseUrl = 'http://creativecommons.org/licenses/by-nc-nd/3.0/';
  const saved = ok(cassetteToSaveRequest(local, 0));
  assert.equal(saved.cassette.tracks[0]!.licenseUrl, 'https://creativecommons.org/licenses/by-nc-nd/3.0/');
  assert.equal(local.tracks[0]!.licenseUrl, 'http://creativecommons.org/licenses/by-nc-nd/3.0/');
  local.tracks[0]!.audioUrl = 'http://storage.jamendo.com/music.mp3';
  invalid(cassetteToSaveRequest(local, 0), 'audioUrl');
});

test('recordings require durable references, never a blob or public-looking playback URL alone', () => {
  const local = tape();
  local.tracks[0] = { ...local.tracks[0]!, source: 'recording', audioUrl: 'blob:local-preview' };
  invalid(cassetteToSaveRequest(local, 0), 'audio');
  local.tracks[0].audioUrl = 'https://cdn.example.com/recording.mp3';
  invalid(cassetteToSaveRequest(local, 0), 'audio');
  assert.equal(local.tracks[0].audioUrl, 'https://cdn.example.com/recording.mp3');
});

test('uploaded/recorded references survive UI adapters while transient playback URLs do not persist', () => {
  for (const source of ['upload', 'recording'] as const) {
    const local = tape();
    local.tracks[0] = { ...local.tracks[0]!, source: 'recording', audioUrl: 'blob:local-preview' };
    const refs = { B: { 'track-b': { ...reference, source } } };
    freeze(refs);
    const saved = ok(cassetteToSaveRequest(local, 1, refs));
    assert.equal(saved.cassette.tracks[0]!.source, source);
    assert.equal('audioUrl' in saved.cassette.tracks[0]!, false);
    const restored = ok(cassetteFromDocument(document(saved.cassette)));
    assert.equal(restored.cassette.tracks[0]!.source, source);
    assert.deepEqual(restored.cassette.tracks[0]!.audioReference, refs.B['track-b']);
    assert.equal(restored.cassette.tracks[0]!.audioUrl, undefined);
    assert.deepEqual(restored.audioReferences.B?.['track-b'], refs.B['track-b']);
    assert.deepEqual(ok(cassetteToSaveRequest(restored.cassette, 1, restored.audioReferences)), saved);
  }
});

test('reference dictionaries are prototype-safe for constructor and __proto__ track IDs', () => {
  for (const id of ['constructor', '__proto__']) {
    const local = tape();
    local.tracks[0] = { ...local.tracks[0]!, id, source: 'recording' };
    invalid(cassetteToSaveRequest(local, 0, { B: {} }), 'audio');
    const own = Object.create(null) as Record<string, StoredAudioReference>;
    own[id] = reference;
    const saved = ok(cassetteToSaveRequest(local, 0, { B: own }));
    const restored = ok(cassetteFromDocument(document(saved.cassette)));
    assert.ok(Object.hasOwn(restored.audioReferences.B!, id));
    assert.deepEqual(restored.audioReferences.B![id], reference);
  }
});

test('current UI upload references round-trip without duplicating wire fields or weakening source validation', () => {
  const local = tape();
  local.tracks[0] = { ...local.tracks[0]!, source: 'upload', audioReference: { ...reference, source: 'upload' } };
  const saved = ok(cassetteToSaveRequest(local, 0));
  assert.equal(saved.cassette.tracks[0]!.source, 'upload');
  assert.equal(Object.hasOwn(saved.cassette.tracks[0]!, 'audioReference'), false);
  const restored = ok(cassetteFromDocument(document(saved.cassette)));
  assert.equal(restored.cassette.tracks[0]!.source, 'upload');
  assert.deepEqual(restored.cassette.tracks[0]!.audioReference, local.tracks[0]!.audioReference);
  assert.deepEqual(ok(cassetteToSaveRequest(restored.cassette, 0)), saved);
  local.tracks[0]!.audioReference!.source = 'recording';
  invalid(cassetteToSaveRequest(local, 0), 'audio.source');
  local.tracks[0]!.source = 'library';
  invalid(cassetteToSaveRequest(local, 0), 'audioReference');
});

test('unknown/server-owned input fields and inline blobs/SVG descriptors are rejected', () => {
  for (const key of ['ownerSub', 'PK', 'SK', 'createdAt', 'updatedAt', 'schemaVersion', 'revision', 'jwt', 'credentials']) {
    invalid(validateSaveCassetteRequest({ ...save(), [key]: 'not-client-owned' }), key);
    const input = save();
    invalid(validateSaveCassetteRequest({ ...input, cassette: { ...input.cassette, [key]: 'not-client-owned' } }), key);
  }
  const input = save();
  input.cassette.stickers[0]!.kind = '<svg><script>bad</script></svg>';
  invalid(validateSaveCassetteRequest(input), 'kind');
  invalid(validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, audioBlob: new Uint8Array([1]) } }), 'audioBlob');
});

test('finite numeric bounds, enums, colors, string caps and required fields are enforced', () => {
  for (const value of [NaN, Infinity, -1, 86_401]) {
    const input = save(); input.cassette.tracks[0]!.durationSec = value;
    invalid(validateSaveCassetteRequest(input), 'durationSec');
  }
  for (const [field, value] of [['x', -1], ['y', 101], ['rotation', 361], ['scale', 0], ['scale', Infinity]] as const) {
    const input = save(); input.cassette.stickers[0]![field] = value;
    invalid(validateSaveCassetteRequest(input), field);
  }
  invalid(validateSaveCassetteRequest({ cassette: {}, expectedRevision: 0 }), 'id');
  invalid(validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, shellType: 'metal' } }), 'shellType');
  invalid(validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, penStyle: 'unknown' } }), 'penStyle');
  invalid(validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, shellColor: 'url(data:...)' } }), 'shellColor');
  invalid(validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, name: 'x'.repeat(121) } }), 'name');
  assert.equal(validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, name: '' } }).ok, true);
});

test('track IDs are globally unique; sticker IDs are unique only within their own side', () => {
  const input = save();
  assert.equal(validateSaveCassetteRequest(input).ok, true); // same sticker ID on A and B
  input.cassette.tracks[1]!.id = input.cassette.tracks[0]!.id;
  invalid(validateSaveCassetteRequest(input), 'tracks[1].id');
  const stickers = save();
  stickers.cassette.stickers.push({ ...stickers.cassette.stickers[0]! });
  invalid(validateSaveCassetteRequest(stickers), 'stickers[1].id');
});

test('100 tracks per cassette and 100 stickers per side are accepted; one extra is rejected', () => {
  const input = save();
  input.cassette.tracks = Array.from({ length: 100 }, (_, index) => ({ ...input.cassette.tracks[0]!, id: `track-${index}`, side: index % 2 ? 'A' : 'B' }));
  input.cassette.stickers = Array.from({ length: 100 }, (_, index) => ({ ...input.cassette.stickers[0]!, id: `sticker-${index}` }));
  input.cassette.sideB = { stickers: input.cassette.stickers.map((entry) => ({ ...entry })) };
  assert.equal(validateSaveCassetteRequest(input).ok, true);
  input.cassette.tracks.push({ ...input.cassette.tracks[0]!, id: 'extra' });
  invalid(validateSaveCassetteRequest(input), 'tracks');
  input.cassette.tracks.pop();
  input.cassette.sideB.stickers!.push({ ...input.cassette.stickers[0]!, id: 'extra' });
  invalid(validateSaveCassetteRequest(input), 'sideB.stickers');
});

test('unsafe, private, credential-bearing, signed or expiring URL snapshots are rejected', () => {
  for (const url of [
    'http://cdn.example.com/audio.mp3', 'data:audio/wav;base64,AA', 'blob:preview', 'javascript:alert(1)',
    'https://user:pass@cdn.example.com/audio.mp3', 'https://localhost/audio.mp3', 'https://127.0.0.1/a',
    'https://[::1]/a', 'https://cdn.local/a', 'https://cdn.example.com/a?X-Amz-Signature=bad',
    'https://cdn.example.com/a?Expires=123', 'https://cdn.example.com/a?token=bad',
    'https://cdn.example.com/a#eyJhbGci.token.signature',
  ]) {
    const input = save();
    const library = input.cassette.tracks[0]!;
    assert.equal(library.source, 'library');
    if (library.source === 'library') library.audioUrl = url;
    invalid(validateSaveCassetteRequest(input), 'audioUrl');
  }
});

test('audio references require exact safe metadata and matching source, not ownership assumptions', () => {
  const local = tape(); local.tracks[0] = { ...local.tracks[0]!, source: 'recording' };
  for (const changes of [
    { objectKey: '../file' }, { objectKey: 'https://cdn.example.com/a' },
    { objectKey: 'audio/x?token=bad' }, { contentType: 'image/svg+xml' }, { sizeBytes: 0 },
    { sizeBytes: 25_000_001 }, { sizeBytes: Infinity }, { owner: 'someone' },
  ]) invalid(cassetteToSaveRequest(local, 0, { B: { 'track-b': { ...reference, ...changes } } }), 'audio');
  const valid = ok(cassetteToSaveRequest(local, 0, { B: { 'track-b': reference } }));
  const stored = valid.cassette.tracks[0]!;
  if (stored.provider === 's3') stored.audio.source = 'upload';
  invalid(validateSaveCassetteRequest(valid), 'audio.source');
});

function atMetadataLimit(): SaveCassetteRequest {
  const input = save();
  input.cassette.tracks = Array.from({ length: 100 }, (_, index) => ({ ...input.cassette.tracks[0]!, id: `t-${index}` }));
  for (const track of input.cassette.tracks) {
    for (const field of ['audioUrl', 'artworkUrl', 'licenseUrl'] as const) {
      const library = track as Extract<typeof track, { source: 'library' }>;
      library[field] = `https://cdn.example.com/${'x'.repeat(1976)}`;
      const excess = new TextEncoder().encode(JSON.stringify(input.cassette)).byteLength - CASSETTE_LIMITS.metadataBytes;
      if (excess >= 0) {
        library[field] = library[field]!.slice(0, library[field]!.length - excess);
        assert.ok(library[field]!.startsWith('https://cdn.example.com/'));
        return input;
      }
    }
  }
  assert.fail('Fixture did not reach metadata limit');
}

test('payload exactly at 256 KiB saves and restores with server envelope; one extra UTF-8 byte fails', () => {
  const input = atMetadataLimit();
  assert.equal(new TextEncoder().encode(JSON.stringify(input.cassette)).byteLength, CASSETTE_LIMITS.metadataBytes);
  const saved = ok(validateSaveCassetteRequest(input));
  const record = ok(validateCassetteDocument(document(saved.cassette)));
  assert.equal(cassetteFromDocument(record).ok, true);
  input.cassette.name += 'x';
  invalid(validateSaveCassetteRequest(input), '$');
});

test('metadata size is UTF-8 bytes, not JavaScript string length', () => {
  const input = atMetadataLimit();
  const track = input.cassette.tracks[0]!;
  track.title = '🎵';
  assert.ok(JSON.stringify(input.cassette).length < CASSETTE_LIMITS.metadataBytes);
  // Fill the UTF-8 difference so this payload is one byte beyond the cap.
  const bytes = new TextEncoder().encode(JSON.stringify(input.cassette)).byteLength;
  input.cassette.name += 'x'.repeat(Math.max(0, CASSETTE_LIMITS.metadataBytes + 1 - bytes));
  invalid(validateSaveCassetteRequest(input), '$');
});

test('create/update/delete revisions and versioned server documents are strict', () => {
  assert.equal(validateSaveCassetteRequest({ ...save(), expectedRevision: 0 }).ok, true);
  assert.equal(validateSaveCassetteRequest({ ...save(), expectedRevision: 2 }).ok, true);
  for (const revision of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) invalid(validateSaveCassetteRequest({ ...save(), expectedRevision: revision }), 'expectedRevision');
  assert.equal(validateDeleteCassetteRequest({ expectedRevision: 1 }).ok, true);
  invalid(validateDeleteCassetteRequest({ expectedRevision: 0 }), 'expectedRevision');
  invalid(validateCassetteDocument({ ...document(save().cassette), schemaVersion: 2 }), 'schemaVersion');
  invalid(validateCassetteDocument({ ...document(save().cassette), revision: 0 }), 'revision');
  invalid(validateCassetteDocument({ ...document(save().cassette), createdAt: 'yesterday' }), 'createdAt');
  invalid(validateCassetteDocument({ ...document(save().cassette), updatedAt: '2026-01-01T00:00:00.000Z' }), 'updatedAt');
});

test('list contract accepts only bounded opaque cursors/limits, never owner-selected keys', () => {
  assert.equal(validateListCassettesRequest({ limit: 100, cursor: 'opaque_cursor.v1' }).ok, true);
  invalid(validateListCassettesRequest({ limit: 101 }), 'limit');
  invalid(validateListCassettesRequest({ cursor: 'x'.repeat(2049) }), 'cursor');
  invalid(validateListCassettesRequest({ ownerSub: 'foreign' }), 'ownerSub');
  invalid(validateListCassettesRequest({ PK: 'USER#foreign' }), 'PK');
});

test('hand-drawn custom stickers round-trip and are bounded', () => {
  const art = { id: 'drawn-1', slot: 2, strokes: [{ color: '#ef4444', width: 5, points: [10, 10, 50.5, 60, 90, 90] }, { color: '#fff', width: 2.5, points: [40, 40] }] };
  const local = { ...tape(), customStickers: [art], stickers: [{ id: 'placed', kind: 'custom-drawn-1', x: 50, y: 50, rotation: 0, scale: 1, color: '#ef4444' }] };
  const request = ok(cassetteToSaveRequest(local, 0));
  assert.deepEqual(request.cassette.customStickers, [art]);
  const restored = ok(cassetteFromDocument(document(request.cassette))).cassette;
  assert.deepEqual(restored.customStickers, [art]);

  const withArt = (customStickers: unknown) => validateSaveCassetteRequest({ ...save(), cassette: { ...save().cassette, customStickers } });
  invalid(withArt('<svg/>'), 'customStickers');
  invalid(withArt(Array.from({ length: CASSETTE_LIMITS.customStickers + 1 }, (_, i) => ({ ...art, id: `a${i}`, slot: i % 5 }))), 'customStickers');
  invalid(withArt([art, { ...art, id: 'drawn-2' }]), 'customStickers[1].slot');
  invalid(withArt([{ ...art, slot: 5 }]), 'slot');
  invalid(withArt([{ ...art, strokes: [{ color: 'red', width: 5, points: [1, 1] }] }]), 'color');
  invalid(withArt([{ ...art, strokes: [{ color: '#fff', width: 5, points: [1, 101] }] }]), 'points');
  invalid(withArt([{ ...art, strokes: [{ color: '#fff', width: 5, points: [1, 2, 3] }] }]), 'points');
  invalid(withArt([{ ...art, strokes: [{ color: '#fff', width: 5, points: [1, 1], d: 'M0 0' }] }]), 'strokes[0].d');
  const huge = Array.from({ length: CASSETTE_LIMITS.customStickerCoords + 2 }, () => 50);
  invalid(withArt([{ ...art, strokes: [{ color: '#fff', width: 5, points: huge }] }]), 'strokes');

  // The lenient reader (public profile snapshots) keeps good drawings and drops bad ones.
  assert.deepEqual(sanitizeCustomStickers([art, { ...art, id: 'dupe-slot' }, { id: 'x', slot: 0, strokes: [{ color: '#fff', width: 99, points: [1, 1] }] }, 'junk']), [art, { id: 'x', slot: 0, strokes: [] }]);
  assert.equal(sanitizeCustomStickers('nope'), undefined);
});

test('tape and own-audio visibility round-trip; other sources drop it and bad values are rejected', () => {
  const upload: StoredAudioReference = { ...reference, source: 'upload' };
  const local: Cassette = { ...tape(), visibility: 'public', tracks: [
    { id: 'own', source: 'upload', title: 'Mine', artist: 'Me', durationSec: 5, side: 'A', audioReference: upload, visibility: 'public' },
    { id: 'lib', source: 'library', sourceId: '123', title: 'Theirs', artist: 'Them', durationSec: 5, side: 'B', visibility: 'public' },
  ] };
  const saved = ok(cassetteToSaveRequest(local, 0));
  assert.equal(saved.cassette.visibility, 'public');
  const own = saved.cassette.tracks[0];
  assert.equal(own.provider === 's3' && own.visibility, 'public');
  assert.equal('visibility' in saved.cassette.tracks[1], false);
  const restored = ok(cassetteFromDocument(document(saved.cassette))).cassette;
  assert.equal(restored.visibility, 'public');
  assert.equal(restored.tracks[0].visibility, 'public');
  invalid(validateSaveCassetteRequest({ ...saved, cassette: { ...saved.cassette, visibility: 'friends' } }), 'cassette.visibility');
  invalid(validateSaveCassetteRequest({ ...saved, cassette: { ...saved.cassette, tracks: [{ ...saved.cassette.tracks[1], visibility: 'public' }] } }), 'tracks[0].visibility');
});

test('community (Explore) tracks persist sourceId + hasAudio and rebuild their stable audio URL on restore', () => {
  const local: Cassette = { ...tape(), tracks: [
    { id: 'c1', source: 'community', sourceId: 'song-1', title: 'Shared', artist: 'Friend', durationSec: 30, side: 'A', audioUrl: 'http://localhost:4000/api/explore/songs/song-1/audio' },
    { id: 'c2', source: 'community', sourceId: 'song-2', title: 'Silent', artist: 'Friend', durationSec: 30, side: 'A' },
  ] };
  const saved = ok(cassetteToSaveRequest(local, 0));
  assert.deepEqual(saved.cassette.tracks.map((track) => track.source === 'community' && [track.provider, track.hasAudio]), [['explore', true], ['explore', false]]);
  assert.equal(JSON.stringify(saved).includes('localhost'), false);
  const url = (id: string) => `/api/explore/songs/${id}/audio`;
  const restored = ok(cassetteFromDocument(document(saved.cassette), { communityAudioUrl: url })).cassette;
  assert.equal(restored.tracks[0].audioUrl, '/api/explore/songs/song-1/audio');
  assert.equal(restored.tracks[1].audioUrl, undefined);
  assert.equal(restored.tracks[0].source, 'community');
  const [first] = saved.cassette.tracks;
  invalid(validateSaveCassetteRequest({ ...saved, cassette: { ...saved.cassette, tracks: [{ ...first, sourceId: '../x' }] } }), 'tracks[0].sourceId');
  invalid(validateSaveCassetteRequest({ ...saved, cassette: { ...saved.cassette, tracks: [{ ...first, hasAudio: 'yes' }] } }), 'tracks[0].hasAudio');
  invalid(validateSaveCassetteRequest({ ...saved, cassette: { ...saved.cassette, tracks: [{ ...first, audio: reference }] } }), 'tracks[0].audio');
});

test('a public tape copies into a library cassette with playable Explore tracks', () => {
  const copy = cassetteFromPublicTape({
    id: 'their-tape', name: 'Their Mix', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'clear', penStyle: 'script',
    stickers: [], sideB: { penStyle: 'marker' },
    tracks: [
      { id: 'j', source: 'library', provider: 'jamendo', sourceId: '42', title: 'Jam', artist: 'Band', durationSec: 60, side: 'A' },
      { id: 'u', source: 'community', provider: 'explore', sourceId: 'song-9', hasAudio: true, title: 'Their upload', artist: 'Them', durationSec: 30, side: 'B' },
    ],
  }, { communityAudioUrl: (id) => `/api/explore/songs/${id}/audio` });
  assert.equal('id' in copy, false);
  assert.deepEqual(copy.sideB, { penStyle: 'marker' });
  assert.deepEqual(copy.tracks, [
    { id: 'j', source: 'library', sourceId: '42', title: 'Jam', artist: 'Band', durationSec: 60, side: 'A' },
    { id: 'u', source: 'community', sourceId: 'song-9', title: 'Their upload', artist: 'Them', durationSec: 30, side: 'B', audioUrl: '/api/explore/songs/song-9/audio' },
  ]);
  const saved = ok(cassetteToSaveRequest({ ...copy, id: 'mine', createdAt: timestamp, updatedAt: timestamp }, 0));
  assert.deepEqual(saved.cassette.tracks.map((t) => t.provider), ['jamendo', 'explore'], 'the copy saves to the cloud');
});
