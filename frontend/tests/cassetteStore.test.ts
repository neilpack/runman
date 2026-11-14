import { createEditorSaver } from '../src/cassettes/editorSaver';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cassetteToSaveRequest, type Cassette, type CassetteDocument, type CassetteResponse, type ListCassettesResponse } from '@runman/shared';
import { CassetteApiError, type CassetteApi } from '../src/api/cassetteClient';
import { createCassetteStore } from '../src/cassettes/store';

const time = '2026-11-14T01:00:00.000Z';
function tape(id = 'tape-1', name = 'Mix'): Cassette {
  return { id, name, shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'marker', stickers: [], tracks: [], createdAt: time, updatedAt: time };
}
function document(id = 'tape-1', revision = 1, name = 'Mix'): CassetteDocument {
  const converted = cassetteToSaveRequest(tape(id, name), 0);
  assert.equal(converted.ok, true);
  if (!converted.ok) throw new Error('Invalid fixture');
  return { schemaVersion: 1, revision, createdAt: time, updatedAt: time, payload: converted.value.cassette };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const key = (owner: string | null, namespace = 'pool:client') => `runman.cassettes.v2:${encodeURIComponent(namespace)}:${owner === null ? 'guest' : `owner:${owner}`}`;
const envelope = (doc: CassetteDocument) => JSON.stringify({ version: 1, drafts: [{ cassette: { ...doc.payload, createdAt: doc.createdAt, updatedAt: doc.updatedAt }, baseline: doc, conflict: false, cloudMissing: false }] });
function harness(overrides: Partial<CassetteApi> = {}, disk = new Map<string, string>(), namespace = 'pool:client') {
  let serial = 0;
  let quota = false;
  const api: CassetteApi = {
    list: async () => ({ items: [] }), get: async (_owner, id) => ({ cassette: document(id) }),
    save: async (_owner, request) => ({ cassette: { schemaVersion: 1, revision: request.expectedRevision + 1, createdAt: time, updatedAt: time, payload: request.cassette } }),
    remove: async (_owner, id, revision) => ({ id, deletedRevision: revision }), ...overrides,
  };
  const store = createCassetteStore({ api, namespace, storage: { getItem: (id) => disk.get(id) ?? null, setItem: (id, value) => { if (quota) throw new Error('quota'); disk.set(id, value); } }, newId: () => `fresh-${++serial}`, now: () => time });
  return { store, disk, api, quota: (value: boolean) => { quota = value; } };
}

test('merged upload UI tracks and references remain local when private-audio API saving is refused', async () => {
  const { store } = harness({ save: async (_owner, input) => {
    assert.equal(input.cassette.tracks[0]!.source, 'upload');
    assert.equal(Object.hasOwn(input.cassette.tracks[0]!, 'audioReference'), false);
    throw new CassetteApiError(422, 'Private audio saving is not connected.');
  } });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create();
  const upload = { id: 'uploaded', source: 'upload' as const, title: 'My upload', artist: '', durationSec: 10, side: 'A' as const,
    audioReference: { source: 'upload' as const, objectKey: 'audio/example/file.mp3', contentType: 'audio/mpeg', sizeBytes: 500 } };
  store.update(local.id, { tracks: [upload] });
  assert.deepEqual(store.get(local.id)?.tracks, [upload]);
  assert.equal(await store.save(local.id), false);
  assert.equal(store.getSync().tapes[local.id].revision, 0);
  assert.match(store.getSync().tapes[local.id].error!, /Private audio/);
  store.setSession('guest'); store.setSession('authenticated', 'alice'); await tick();
  assert.deepEqual(store.get(local.id)?.tracks, [upload]);
});

test('Explore community tracks survive draft updates and fail cloud save explicitly without dropping tracks', async () => {
  let saves = 0;
  const { store } = harness({ save: async () => { saves++; throw new Error('Unexpected save'); } });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create();
  const community = { id: 'community-track', sourceId: 'public-song-1', source: 'community' as const, title: 'Explore song', artist: 'Artist', durationSec: 30, side: 'A' as const, audioUrl: '/api/explore/songs/public-song-1/audio' };
  store.update(local.id, { tracks: [community] });
  assert.deepEqual(store.get(local.id)?.tracks, [community]);
  assert.equal(await store.save(local.id), false);
  assert.equal(saves, 0);
  assert.match(store.getSync().tapes[local.id].issues![0].message, /Community-song/);
  store.setSession('hidden'); store.setSession('authenticated', 'alice'); await tick();
  assert.deepEqual(store.get(local.id)?.tracks, [community]);
});

test('account transitions abort requests and reject stale results even after returning to the same owner', async () => {
  const pending = deferred<ListCassettesResponse>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const { store } = harness({ list: async (_owner, _options, passed) => { signal = passed; return ++calls === 1 ? pending.promise : { items: [] }; } });
  store.setSession('authenticated', 'alice');
  const first = store.getSync().context;
  store.setSession('hidden');
  assert.equal(signal?.aborted, true);
  assert.deepEqual(store.getAll(), []);
  store.setSession('authenticated', 'alice');
  assert.ok(store.getSync().context > first);
  pending.resolve({ items: [document()] });
  await tick();
  assert.equal(store.get('tape-1'), undefined);
  const context = store.getSync().context;
  store.setSession('authenticated', 'alice');
  assert.equal(store.getSync().context, context);
});

test('save advances the baseline without losing edits made in flight and serializes tape operations', async () => {
  const pending = deferred<CassetteResponse>();
  const revisions: number[] = [];
  let saved: Parameters<CassetteApi['save']>[1] | undefined;
  const { store } = harness({ save: async (_owner, request) => { revisions.push(request.expectedRevision); saved = request; return revisions.length === 1 ? pending.promise : { cassette: { ...document(request.cassette.id, 2), payload: request.cassette } }; } });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create();
  const saving = store.save(local.id);
  assert.equal(await store.remove(local.id), false);
  assert.equal(await store.save(local.id), false);
  store.update(local.id, { name: 'Later edit' });
  assert.ok(saved);
  pending.resolve({ cassette: { ...document(local.id), payload: saved.cassette } });
  assert.equal(await saving, true);
  assert.equal(store.get(local.id)?.name, 'Later edit');
  assert.equal(store.getSync().tapes[local.id].revision, 1);
  assert.equal(store.getSync().tapes[local.id].dirty, true);
  assert.equal(await store.save(local.id), true);
  assert.deepEqual(revisions, [0, 1]);
  assert.equal(store.getSync().tapes[local.id].dirty, false);
});

test('conflicts and failed requests retain drafts and retry the acknowledged revision only', async () => {
  const attempts: number[] = [];
  const { store } = harness({ list: async () => ({ items: [document()] }), save: async (_owner, request) => { attempts.push(request.expectedRevision); throw new CassetteApiError(attempts.length === 1 ? 503 : 409, 'Try again'); }, remove: async () => { throw new CassetteApiError(409, 'Changed'); } });
  store.setSession('authenticated', 'alice'); await tick();
  store.update('tape-1', { name: 'Keep me' });
  assert.equal(await store.save('tape-1'), false);
  assert.equal(await store.save('tape-1'), false);
  assert.deepEqual(attempts, [1, 1]);
  assert.equal(store.get('tape-1')?.name, 'Keep me');
  assert.equal(store.getSync().tapes['tape-1'].conflict, true);
  assert.equal(await store.remove('tape-1'), false);
  assert.ok(store.get('tape-1'));
  assert.equal(await store.reload('tape-1'), false);
});

test('pagination merges without deleting absent tapes or overwriting dirty drafts', async () => {
  let page = 0;
  const { store } = harness({ list: async (_owner, options) => {
    if (++page === 1) return { items: [document()], nextCursor: 'next' };
    assert.equal(options?.cursor, 'next');
    return { items: [document('tape-1', 2, 'Remote'), document('tape-2')] };
  } });
  store.setSession('authenticated', 'alice'); await tick();
  store.update('tape-1', { name: 'Draft' });
  await store.loadMore();
  assert.equal(store.get('tape-1')?.name, 'Draft');
  assert.equal(store.getSync().tapes['tape-1'].revision, 1);
  assert.equal(store.getSync().tapes['tape-1'].conflict, true);
  assert.ok(store.get('tape-2'));
  assert.equal(store.getSync().nextCursor, undefined);
});

test('late direct GET cannot overwrite a list-installed edit or resurrect its local deletion', async () => {
  for (const deleted of [false, true]) {
    const page = deferred<ListCassettesResponse>();
    const get = deferred<CassetteResponse>();
    const { store } = harness({ list: async () => page.promise, get: async () => get.promise });
    store.setSession('authenticated', 'alice');
    const loading = store.ensureLoaded('tape-1');
    page.resolve({ items: [document()] }); await tick();
    if (deleted) assert.equal(await store.remove('tape-1'), true);
    else store.update('tape-1', { name: 'Preserve edit' });
    get.resolve({ cassette: document() }); await loading;
    assert.equal(store.get('tape-1')?.name, deleted ? undefined : 'Preserve edit');
  }
});

test('reload preserves concurrent edits and newer cloud revisions observed by a list', async () => {
  const get = deferred<CassetteResponse>();
  let pages = 0;
  const { store } = harness({ list: async () => ({ items: [document('tape-1', ++pages)] }), get: async () => get.promise });
  store.setSession('authenticated', 'alice'); await tick();
  const reload = store.reload('tape-1', true);
  await store.refresh();
  get.resolve({ cassette: document() });
  assert.equal(await reload, false);
  assert.equal(store.getSync().tapes['tape-1'].conflict, true);
  assert.equal(store.getSync().tapes['tape-1'].revision, 1);
});

test('signout aborts a pending save and its late success cannot change the next account', async () => {
  const pending = deferred<CassetteResponse>();
  let request: Parameters<CassetteApi['save']>[1] | undefined;
  let signal: AbortSignal | undefined;
  const { store } = harness({ save: async (_owner, input, passed) => { request = input; signal = passed; return pending.promise; } });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create(); const save = store.save(local.id);
  store.setSession('authenticated', 'bob');
  assert.equal(signal?.aborted, true);
  assert.ok(request);
  pending.resolve({ cassette: { ...document(local.id), payload: request.cassette } });
  assert.equal(await save, false);
  assert.deepEqual(store.getAll(), []);
  store.setSession('authenticated', 'alice'); await tick();
  assert.equal(store.getSync().tapes[local.id].revision, 0);
});

test('guest and legacy tapes require selected copying; originals and unsaveable tracks are retained', async () => {
  let saves = 0;
  const old = tape('old'); old.tracks = [{ id: 'track-1', title: 'Old song', artist: 'Artist', durationSec: 12, side: 'A', source: 'library' }];
  const disk = new Map([['runman.cassettes.v1', JSON.stringify([old])]]);
  const { store } = harness({ save: async () => { saves++; throw new Error('unexpected'); } }, disk);
  store.setSession('guest'); const guest = store.create({ name: 'Guest' });
  const originalGuest = disk.get(key(null)); const originalLegacy = disk.get('runman.cassettes.v1');
  store.setSession('authenticated', 'alice'); await tick();
  assert.deepEqual(store.getAll(), []);
  assert.equal(store.getSync().legacy.length, 2);
  const imported = store.importLegacy(['old', guest.id]);
  assert.equal(imported.length, 2);
  assert.ok(imported.every((entry) => entry.id !== old.id && entry.id !== guest.id));
  const importedOld = imported.find((entry) => entry.tracks.length)!;
  assert.equal(await store.save(importedOld.id), false);
  assert.equal(importedOld.tracks.length, 1);
  assert.ok(store.getSync().tapes[importedOld.id].issues?.length);
  assert.equal(saves, 0);
  assert.equal(disk.get(key(null)), originalGuest);
  assert.equal(disk.get('runman.cassettes.v1'), originalLegacy);
});

test('malformed storage stays untouched and quota-failed edits survive account switches', async () => {
  const disk = new Map([[key('alice'), '{broken']]);
  const { store, quota } = harness({}, disk);
  store.setSession('authenticated', 'alice'); await tick();
  assert.ok(store.getSync().storageError);
  store.create(); assert.equal(disk.get(key('alice')), '{broken');
  store.setSession('authenticated', 'bob'); await tick(); quota(true);
  const local = store.create({ name: 'In memory' });
  assert.ok(store.getSync().storageError);
  store.setSession('hidden'); store.setSession('authenticated', 'bob'); await tick();
  assert.equal(store.get(local.id)?.name, 'In memory');
  assert.ok(store.getSync().storageError);
});

test('invalid legacy import warning survives successful cloud listing and draft writes', async () => {
  const disk = new Map([['runman.cassettes.v1', '{broken']]);
  const { store } = harness({}, disk);
  store.setSession('authenticated', 'alice'); await tick();
  assert.ok(store.getSync().storageError);
  store.create();
  assert.ok(store.getSync().storageError);
  assert.equal(disk.get('runman.cassettes.v1'), '{broken');
});

test('inactive clean caches reload external storage while dirty or quota caches preserve memory and disk', async () => {
  for (const condition of ['clean', 'dirty', 'quota'] as const) {
    const disk = new Map([[key('alice'), envelope(document())]]);
    const { store, quota } = harness({}, disk);
    store.setSession('authenticated', 'alice'); await tick();
    if (condition !== 'clean') { quota(condition === 'quota'); store.update('tape-1', { name: 'Memory edit' }); }
    store.setSession('hidden');
    const external = envelope(document('tape-1', 2, 'External'));
    disk.set(key('alice'), external); store.storageChanged(key('alice'));
    store.setSession('authenticated', 'alice'); await tick();
    assert.equal(store.get('tape-1')?.name, condition === 'clean' ? 'External' : 'Memory edit');
    assert.equal(Boolean(store.getSync().storageError), condition !== 'clean');
    assert.equal(disk.get(key('alice')), external);
  }
});

test('storage clear events invalidate inactive caches and active dirty events never overwrite disk', async () => {
  const disk = new Map([[key('alice'), envelope(document())]]);
  const { store } = harness({}, disk);
  store.setSession('authenticated', 'alice'); await tick();
  store.setSession('authenticated', 'bob'); await tick();
  disk.delete(key('alice')); store.storageChanged(null);
  store.setSession('authenticated', 'alice'); await tick();
  assert.equal(store.get('tape-1'), undefined);
  const local = store.create();
  const external = envelope(document('other'));
  disk.set(key('alice'), external); store.storageChanged(key('alice'));
  store.update(local.id, { name: 'Still here' });
  assert.equal(disk.get(key('alice')), external);
  assert.equal(store.get(local.id)?.name, 'Still here');
  assert.ok(store.getSync().storageError);
});

test('pool/client namespaces and prototype-like IDs remain isolated and safe', async () => {
  const disk = new Map<string, string>();
  const first = harness({}, disk); first.store.setSession('authenticated', 'alice'); await tick();
  first.store.create({ id: '__proto__' }); first.store.create({ id: 'constructor' });
  assert.equal(Object.getPrototypeOf(first.store.getSync().tapes), null);
  assert.equal(first.store.getSync().tapes['__proto__'].dirty, true);
  const second = harness({}, disk, 'other-pool:client');
  second.store.setSession('authenticated', 'alice'); await tick();
  assert.deepEqual(second.store.getAll(), []);
});


test('Done waits for an in-flight autosave and saves edits made during it', async () => {
  const first = deferred<CassetteResponse>();
  const requests: number[] = [];
  const { store } = harness({ save: async (_owner, request) => {
    requests.push(request.expectedRevision);
    if (requests.length === 1) return first.promise;
    return { cassette: { ...document(request.cassette.id, request.expectedRevision + 1), payload: request.cassette } };
  } });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create();
  const saver = createEditorSaver(store, local.id, store.getSync().context);
  const autosave = saver();
  store.update(local.id, { name: 'Latest mix' });
  const done = saver();
  assert.equal(autosave, done);
  const initial = cassetteToSaveRequest(local, 0);
  assert.equal(initial.ok, true);
  if (!initial.ok) throw new Error('Invalid fixture');
  first.resolve({ cassette: { ...document(local.id, 1), payload: initial.value.cassette } });
  assert.equal(await done, true);
  assert.deepEqual(requests, [0, 1]);
  assert.equal(store.getSync().tapes[local.id].dirty, false);
  assert.equal(store.get(local.id)?.name, 'Latest mix');
});

test('failed autosaves keep edits and Done can retry without a retry loop', async () => {
  let calls = 0;
  const { store } = harness({ save: async (_owner, request) => {
    if (++calls === 1) throw new Error('Offline');
    return { cassette: { ...document(request.cassette.id, 1), payload: request.cassette } };
  } });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create();
  const saver = createEditorSaver(store, local.id, store.getSync().context);
  assert.equal(await saver(), false);
  assert.equal(calls, 1);
  assert.equal(store.getSync().tapes[local.id].dirty, true);
  assert.equal(await saver(), true);
});

test('an account change stops the editor save before saving further edits', async () => {
  const response = deferred<CassetteResponse>();
  const { store } = harness({ save: async () => response.promise });
  store.setSession('authenticated', 'alice'); await tick();
  const local = store.create();
  const saver = createEditorSaver(store, local.id, store.getSync().context);
  const saving = saver();
  store.setSession('authenticated', 'bob');
  response.resolve({ cassette: document(local.id, 1, local.name) });
  assert.equal(await saving, false);
  assert.equal(await saver(), false);
});
