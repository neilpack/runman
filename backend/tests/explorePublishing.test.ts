import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { DeleteCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mediaObjectKey, type CassettePayload, type ListenerProfileResponse, type PublicSongPage, type PublicTapePage, type PublicTapeResponse, type StoredAudioReference } from '@runman/shared';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createAccessTokenVerifier } from '../src/middleware/cassetteAuth.js';
import { HttpError } from '../src/middleware/errorHandler.js';
import { CATALOG_PARTITIONS, createDynamoPublicCatalogRepository, type CatalogDynamoCommand, type CatalogDynamoResult } from '../src/aws/dynamoPublicCatalog.js';
import { CatalogConflict, UsernameTaken } from '../src/services/publicCatalogRepository.js';
import { publicSongId } from '../src/services/publishService.js';

const poolId = 'us-west-2_Offline123';
const clientId = 'offlinepublicclient';
const issuer = `https://cognito-idp.us-west-2.amazonaws.com/${poolId}`;
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const now = '2026-11-14T01:00:00.000Z';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });

function token(sub: string) {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'offline-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub, client_id: clientId, token_use: 'access', iat, exp: iat + 600 })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
}

const audio = (owner: string, n: number): StoredAudioReference => ({ source: 'upload', objectKey: mediaObjectKey(owner, `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`), contentType: 'audio/mpeg', sizeBytes: 100 });

async function server(t: TestContext) {
  const verifier = createAccessTokenVerifier(poolId, clientId);
  verifier.cacheJwks({ keys: [{ kty: 'RSA', n: jwk.n!, e: jwk.e!, kid: 'offline-key', use: 'sig', alg: 'RS256' }] });
  const settings = readConfig({
    NODE_ENV: 'development', AWS_REGION: 'us-west-2', CASSETTE_STORAGE_MODE: 'memory',
    COGNITO_USER_POOL_ID: poolId, COGNITO_USER_POOL_CLIENT_ID: clientId,
    CASSETTE_CURSOR_SECRET: 'offline-test-only-cursor-secret-012345678901234567890123456789',
  }).cassettes;
  const plays: string[] = [];
  const media = {
    async authorize(owner: string, reference: StoredAudioReference) {
      if (!reference.objectKey.startsWith(`private/${owner}/`)) throw new HttpError(422, 'Private audio does not belong to this account.');
    },
    async playback(owner: string, body: unknown) {
      plays.push(`${owner}:${(body as { mediaId: string }).mediaId}`);
      return { url: 'https://s3.us-west-2.amazonaws.com/private-bucket/signed', expiresAt: now };
    },
  };
  const listener = createApp({ exploreApi: { settings, verifier, media, clock: () => now } }).listen(0);
  await once(listener, 'listening');
  t.after(() => listener.close());
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  const call = async (method: string, path: string, body?: unknown, sub: string | null = alice) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/explore${path}`, {
      method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(sub ? { Authorization: `Bearer ${token(sub)}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), body: (text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null) as Record<string, any> };
  };
  return { call, plays };
}

const profile = (username: string) => ({ username, avatar: null, favoriteTape: null });

test('a username is claimed once, renames release the old name, and ifPublished never creates', async (t) => {
  const { call } = await server(t);
  assert.deepEqual((await call('PUT', '/mine/profile', { ...profile('tapehead'), ifPublished: true })).body, { profile: null });
  assert.equal((await call('PUT', '/mine/profile', profile('tapehead'))).status, 200);
  assert.equal((await call('PUT', '/mine/profile', profile('TapeHead'), bob)).status, 409, 'usernames are case-insensitively unique');
  assert.equal((await call('PUT', '/mine/profile', profile('mixmaster'))).status, 200);
  assert.equal((await call('PUT', '/mine/profile', profile('tapehead'), bob)).status, 200, 'the old name is free after a rename');
  for (const bad of [{ username: 'x' }, profile('-bad-'), { ...profile('fine'), avatar: 'javascript:alert(1)' }, { ...profile('fine'), userId: bob }]) {
    assert.equal((await call('PUT', '/mine/profile', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PUT', '/mine/profile', profile('nope'), null)).status, 401);
});

test('songs need a profile and owned audio, stream through owner-checked playback, and only the owner can unpublish', async (t) => {
  const { call, plays } = await server(t);
  const song = { title: 'My Demo', artist: 'Alice', durationSec: 42, audio: audio(alice, 1) };
  assert.equal((await call('PUT', '/mine/songs', song)).status, 409, 'profile first');
  await call('PUT', '/mine/profile', profile('alice'));
  assert.equal((await call('PUT', '/mine/songs', { ...song, audio: audio(bob, 1) })).status, 422, "someone else's audio");
  const published = await call('PUT', '/mine/songs', song);
  assert.equal(published.status, 200);
  assert.equal(published.body.song.uploader.username, 'alice');
  assert.equal(published.body.song.hasAudio, true);
  const id = published.body.song.id as string;
  assert.equal(id, publicSongId(alice, song.audio.objectKey));
  assert.equal((await call('PUT', '/mine/songs', { ...song, title: 'Renamed' })).body.song.id, id, 'republishing updates the same row');

  const page = (await call('GET', '/songs?q=renamed', undefined, null)).body as PublicSongPage;
  assert.deepEqual(page.songs.map((s) => s.id), [id]);
  assert.equal(page.catalog, 'demo');
  const stream = await call('GET', `/songs/${id}/audio`, undefined, null);
  assert.equal(stream.status, 302);
  assert.equal(stream.location, 'https://s3.us-west-2.amazonaws.com/private-bucket/signed');
  assert.deepEqual(plays, [`${alice}:aaaaaaaa-aaaa-4aaa-8aaa-000000000001`]);

  assert.equal((await call('DELETE', '/mine/songs', { objectKey: song.audio.objectKey }, bob)).status, 404);
  assert.deepEqual((await call('DELETE', '/mine/songs', { objectKey: song.audio.objectKey })).body, { id });
  assert.equal(((await call('GET', '/songs?q=renamed', undefined, null)).body as PublicSongPage).total, 0);
});

test('a public tape shares every track, including recordings, as Explore songs without leaking object keys', async (t) => {
  const { call, plays } = await server(t);
  await call('PUT', '/mine/profile', profile('alice'));
  const cassette: CassettePayload = {
    id: 'tape-1', name: 'Road Mix', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'marker',
    stickers: [], customStickers: [{ id: 'art', slot: 0, strokes: [{ color: '#ff0000', width: 3, points: [1, 2, 3, 4] }] }], visibility: 'public',
    tracks: [
      { id: 'lib', source: 'library', provider: 'jamendo', sourceId: '123', title: 'Jam', artist: 'Band', durationSec: 60, side: 'A' },
      { id: 'com', source: 'community', provider: 'explore', sourceId: 'someone-elses-song', hasAudio: true, title: 'Found', artist: 'Friend', durationSec: 30, side: 'A' },
      { id: 'pub', source: 'upload', provider: 's3', audio: audio(alice, 2), visibility: 'public', title: 'Shared', artist: 'Alice', durationSec: 10, side: 'B' },
      { id: 'unpub', source: 'upload', provider: 's3', audio: audio(alice, 3), visibility: 'public', title: 'Not yet', artist: 'Alice', durationSec: 10, side: 'B' },
      { id: 'priv', source: 'recording', provider: 's3', audio: { ...audio(alice, 4), source: 'recording' }, title: 'Secret', artist: 'Alice', durationSec: 10, side: 'B' },
    ],
  };
  assert.equal((await call('PUT', '/mine/tapes/other-id', { cassette })).status, 400, 'path must match');
  const published = await call('PUT', '/mine/tapes/tape-1', { cassette });
  assert.equal(published.status, 200);
  const tape = published.body.tape as PublicTapeResponse['tape'];
  assert.deepEqual(tape.tape.tracks.map((track) => track.id), ['lib', 'com', 'pub', 'unpub', 'priv']);
  assert.deepEqual(tape.tape.tracks[2], { id: 'pub', source: 'community', provider: 'explore', sourceId: publicSongId(alice, audio(alice, 2).objectKey), hasAudio: true, title: 'Shared', artist: 'Alice', durationSec: 10, side: 'B' });
  const secretId = publicSongId(alice, audio(alice, 4).objectKey);
  assert.deepEqual(tape.tape.tracks[4], { id: 'priv', source: 'community', provider: 'explore', sourceId: secretId, hasAudio: true, title: 'Secret', artist: 'Alice', durationSec: 10, side: 'B' });

  // The tape's own songs stream for anyone and are listed under Explore → Songs.
  assert.equal((await call('GET', `/songs/${secretId}/audio`, undefined, null)).status, 302);
  assert.equal(plays.at(-1), `${alice}:aaaaaaaa-aaaa-4aaa-8aaa-000000000004`);
  const songs = (await call('GET', '/songs', undefined, null)).body as PublicSongPage;
  assert.deepEqual(songs.songs.filter((x) => !x.id.startsWith('demo-')).map((x) => x.title).sort(), ['Not yet', 'Secret', 'Shared']);
  assert.equal(((await call('GET', '/songs?q=secret', undefined, null)).body as PublicSongPage).total, 1);
  assert.equal((await call('PUT', '/mine/tapes/tape-2', { cassette: { ...cassette, id: 'tape-2', tracks: [{ ...cassette.tracks[4], audio: { ...audio(bob, 9), source: 'recording' } }] } })).status, 422, "someone else's audio");
  assert.equal(JSON.stringify(tape).includes('private/'), false, 'no private object keys');
  assert.equal('visibility' in tape.tape, false);
  assert.equal(tape.tape.customStickers?.length, 1);
  assert.equal(tape.owner.username, 'alice');

  const list = (await call('GET', '/tapes?q=road', undefined, null)).body as PublicTapePage;
  assert.deepEqual(list.tapes.map((x) => x.id), [tape.id]);
  assert.equal(((await call('GET', `/tapes/${tape.id}`, undefined, null)).body as PublicTapeResponse).tape.tape.name, 'Road Mix');
  await call('PUT', '/mine/profile', profile('alice2'));
  const page = (await call('GET', '/profiles/alice2', undefined, null)).body as ListenerProfileResponse;
  assert.deepEqual(page.tapes.map((x) => x.owner.username), ['alice2'], 'renames show on tapes too');

  const sharedId = publicSongId(alice, audio(alice, 2).objectKey);

  assert.equal((await call('DELETE', '/mine/tapes/tape-1', undefined, bob)).status, 404);
  assert.equal((await call('DELETE', '/mine/tapes/tape-1')).status, 200);
  assert.equal((await call('GET', `/tapes/${tape.id}`, undefined, null)).status, 404);
  // A private tape shares nothing: its songs come down with it.
  assert.equal((await call('GET', `/songs/${secretId}/audio`, undefined, null)).status, 404);
  assert.equal((await call('GET', `/songs/${sharedId}/audio`, undefined, null)).status, 404);
  assert.equal(((await call('GET', '/songs?q=secret', undefined, null)).body as PublicSongPage).total, 0);
});

test('dropping a track from a public tape removes its song unless another public tape still uses it', async (t) => {
  const { call } = await server(t);
  await call('PUT', '/mine/profile', profile('alice'));
  const base: CassettePayload = { id: 'tape-9', name: 'B-sides', shellColor: '#123456', labelColor: '#ffffff', inkColor: '#000000', shellType: 'solid', penStyle: 'marker', stickers: [], tracks: [] };
  const own = (id: string, n: number) => ({ id, source: 'upload' as const, provider: 's3' as const, audio: audio(alice, n), title: id, artist: 'Alice', durationSec: 10, side: 'A' as const });
  await call('PUT', '/mine/tapes/tape-9', { cassette: { ...base, tracks: [own('single', 6), own('demo', 7)] } });
  await call('PUT', '/mine/tapes/tape-10', { cassette: { ...base, id: 'tape-10', tracks: [own('single', 6)] } });
  const demoId = publicSongId(alice, audio(alice, 7).objectKey);
  assert.equal((await call('GET', `/songs/${demoId}/audio`, undefined, null)).status, 302);
  await call('PUT', '/mine/tapes/tape-9', { cassette: { ...base, tracks: [] } });
  assert.equal((await call('GET', `/songs/${demoId}/audio`, undefined, null)).status, 404, 'unused song removed');
  assert.equal(((await call('GET', '/songs?q=single', undefined, null)).body as PublicSongPage).total, 1, 'still on tape-10');
});

test('adds count once per listener and need a sign-in', async (t) => {
  const { call } = await server(t);
  await call('PUT', '/mine/profile', profile('alice'));
  const id = (await call('PUT', '/mine/songs', { title: 'Hit', artist: 'Alice', durationSec: 10, audio: audio(alice, 5) })).body.song.id as string;
  assert.equal((await call('POST', `/songs/${id}/adds`, undefined, null)).status, 401);
  assert.deepEqual((await call('POST', `/songs/${id}/adds`, undefined, bob)).body, { addCount: 1 });
  assert.deepEqual((await call('POST', `/songs/${id}/adds`, undefined, bob)).body, { addCount: 1 });
  assert.deepEqual((await call('POST', `/songs/${id}/adds`)).body, { addCount: 2 });
  assert.equal((await call('POST', '/songs/missing/adds')).status, 404);
});

test('Dynamo catalog uses fixed-partition Queries, owner conditions and transactions; never Scan', async () => {
  const commands: CatalogDynamoCommand[] = [];
  const outputs: (CatalogDynamoResult | Error)[] = [];
  const repository = createDynamoPublicCatalogRepository('Tapes', async (command) => {
    commands.push(command);
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  });
  const cancelled = (...codes: string[]) => Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException', CancellationReasons: codes.map((Code) => ({ Code })) });
  const failed = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

  outputs.push({ Items: [{ PK: CATALOG_PARTITIONS.song, SK: 'bad' }], LastEvaluatedKey: { PK: CATALOG_PARTITIONS.song, SK: 'bad' } }, { Items: [] });
  assert.deepEqual(await repository.listSongs(), [], 'invalid rows are skipped');
  assert.equal(commands.every((c) => c instanceof QueryCommand), true, 'listings only Query');
  assert.equal((commands[0] as QueryCommand).input.ExpressionAttributeValues?.[':pk'], 'EXPLORE#SONG');
  assert.deepEqual((commands[1] as QueryCommand).input.ExclusiveStartKey, { PK: CATALOG_PARTITIONS.song, SK: 'bad' });

  commands.length = 0;
  outputs.push(failed());
  await assert.rejects(repository.putSong({ id: 'song-1', ownerId: alice, uploaderUsername: 'alice', title: 'T', artist: 'A', durationSec: 1, audio: audio(alice, 1), listed: true }, now), CatalogConflict);
  const update = commands[0] as UpdateCommand;
  assert.ok(update instanceof UpdateCommand);
  assert.equal(update.input.ConditionExpression, 'attribute_not_exists(#pk) OR #ownerId = :ownerId');
  assert.match(update.input.UpdateExpression!, /if_not_exists\(#addCount, :zero\)/);

  commands.length = 0;
  outputs.push({}, cancelled('ConditionalCheckFailed', 'None'));
  await assert.rejects(repository.putProfile(alice, profile('taken'), now, false), UsernameTaken);
  const transaction = commands[1] as TransactWriteCommand;
  assert.ok(transaction instanceof TransactWriteCommand);
  assert.deepEqual(transaction.input.TransactItems?.[0].Put?.Item, { PK: 'EXPLORE#USERNAME', SK: 'taken', ownerId: alice });

  commands.length = 0;
  outputs.push(failed());
  assert.equal(await repository.deleteTape('tape-1', bob), false);
  const remove = commands[0] as DeleteCommand;
  assert.equal(remove.input.ConditionExpression, 'attribute_exists(#pk) AND #p0.#p1 = :owner');
  assert.deepEqual(remove.input.ExpressionAttributeNames, { '#pk': 'PK', '#p0': 'owner', '#p1': 'userId' });

  commands.length = 0;
  outputs.push(cancelled('None', 'ConditionalCheckFailed'));
  assert.equal(await repository.recordAdd('missing', bob), undefined);
  assert.deepEqual((commands[0] as TransactWriteCommand).input.TransactItems?.[0].Put?.Item, { PK: 'EXPLORE#ADD#missing', SK: bob });
  assert.ok(!commands.some((c) => c instanceof PutCommand && c.input.Item?.PK === 'EXPLORE#SONG'));
});
