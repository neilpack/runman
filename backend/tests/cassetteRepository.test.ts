import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CassetteDocument, SaveCassetteRequest } from '@runman/shared';
import { CassetteCorrupt, createDynamoCassetteRepository, type CassetteDynamoCommand, type CassetteDynamoResult } from '../src/aws/dynamoCassettes.js';
import { CassetteConflict, CassetteMissing, createMemoryCassetteRepository } from '../src/services/cassetteRepository.js';
import { createCassettesService } from '../src/services/cassettesService.js';
import { createCassetteCursor } from '../src/services/cassetteCursor.js';

const first = '2026-11-14T01:00:00.000Z';
const later = '2026-11-14T02:00:00.000Z';
function request(revision = 0): SaveCassetteRequest {
  return { expectedRevision: revision, cassette: { id: 'tape-1', name: 'Mix', shellColor: '#123456', shellType: 'solid', labelColor: '#ffffff', inkColor: '#123456', penStyle: 'marker', stickers: [], tracks: [] } };
}
function document(revision = 1): CassetteDocument {
  return { schemaVersion: 1, revision, createdAt: first, updatedAt: revision === 1 ? first : later, payload: request().cassette };
}
function item(revision = 1) { return { PK: 'USER#owner-a', SK: 'CASSETTE#tape-1', ...document(revision) }; }
function conditional() { const error = new Error('conditional failure'); error.name = 'ConditionalCheckFailedException'; return error; }
function mock(...outputs: (CassetteDynamoResult | Error)[]) {
  const commands: CassetteDynamoCommand[] = [];
  const repository = createDynamoCassetteRepository('OfflineTapes', async (command) => {
    commands.push(command);
    const next = outputs.shift();
    if (next === undefined) assert.fail('Unexpected Dynamo command');
    if (next instanceof Error) throw next;
    return next;
  });
  return { commands, repository };
}

test('memory writes are owner-scoped and atomic by revision, preserving server creation time', async () => {
  const repository = createMemoryCassetteRepository();
  await repository.save('owner-a', request(), first);
  await repository.save('owner-b', request(), first);
  await assert.rejects(repository.save('owner-a', request(), later), CassetteConflict);
  const results = await Promise.allSettled([
    repository.save('owner-a', request(1), later), repository.save('owner-a', request(1), later),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const saved = await repository.get('owner-a', 'tape-1');
  assert.equal(saved?.revision, 2);
  assert.equal(saved?.createdAt, first);
  assert.equal(saved?.updatedAt, later);
  assert.equal((await repository.get('owner-b', 'tape-1'))?.revision, 1);
  assert.equal(await repository.get('owner-c', 'tape-1'), undefined);
  saved!.payload.name = 'external mutation';
  assert.equal((await repository.get('owner-a', 'tape-1'))?.payload.name, 'Mix');
  await assert.rejects(repository.remove('owner-a', 'tape-1', 1), CassetteConflict);
  await assert.rejects(repository.remove('owner-c', 'tape-1', 1), CassetteMissing);
});

test('Dynamo reads use strong owner Get/Query, sorted prefix keys and constructed exclusive keys; never Scan', async () => {
  const { repository, commands } = mock({ Item: item() }, { Items: [item()], LastEvaluatedKey: { PK: 'USER#owner-a', SK: 'CASSETTE#tape-1' } });
  const result = await repository.get('owner-a', 'tape-1');
  assert.deepEqual(result, document());
  assert.equal('PK' in result!, false);
  assert.ok(commands[0] instanceof GetCommand);
  assert.equal(commands[0].input.ConsistentRead, true);
  assert.deepEqual(commands[0].input.Key, { PK: 'USER#owner-a', SK: 'CASSETTE#tape-1' });
  const page = await repository.list('owner-a', 25, 'previous');
  assert.equal(page.afterId, 'tape-1');
  assert.ok(commands[1] instanceof QueryCommand);
  assert.equal(commands[1].input.ScanIndexForward, true);
  assert.equal(commands[1].input.ConsistentRead, true);
  assert.equal(commands[1].input.Limit, 25);
  assert.deepEqual(commands[1].input.ExclusiveStartKey, { PK: 'USER#owner-a', SK: 'CASSETTE#previous' });
  assert.deepEqual(commands[1].input.ExpressionAttributeValues, { ':owner': 'USER#owner-a', ':prefix': 'CASSETTE#' });
  assert.equal(commands.some((command) => command.constructor.name === 'ScanCommand'), false);
});

test('Dynamo conditional create/update/delete use safe revisions and retain createdAt on update', async () => {
  const { repository, commands } = mock({}, { Attributes: item(2) }, {});
  assert.equal((await repository.save('owner-a', request(), first)).revision, 1);
  assert.ok(commands[0] instanceof PutCommand);
  assert.match(commands[0].input.ConditionExpression!, /attribute_not_exists/);
  assert.deepEqual(commands[0].input.Item, item());
  const updated = await repository.save('owner-a', request(1), later);
  assert.equal(updated.createdAt, first);
  assert.equal(updated.updatedAt, later);
  assert.ok(commands[1] instanceof UpdateCommand);
  assert.equal(commands[1].input.ReturnValues, 'ALL_NEW');
  assert.doesNotMatch(commands[1].input.UpdateExpression!, /createdAt/);
  assert.equal(commands[1].input.ExpressionAttributeValues?.[':expected'], 1);
  assert.equal(commands[1].input.ExpressionAttributeValues?.[':next'], 2);
  await repository.remove('owner-a', 'tape-1', 2);
  assert.ok(commands[2] instanceof DeleteCommand);
  assert.match(commands[2].input.ConditionExpression!, /#revision = :expected/);
});

test('Dynamo failed conditions distinguish owner-scoped missing items from revision conflicts', async () => {
  const stale = mock(conditional(), { Item: item() });
  await assert.rejects(stale.repository.save('owner-a', request(2), later), CassetteConflict);
  assert.ok(stale.commands[1] instanceof GetCommand);
  assert.deepEqual(stale.commands[1].input.Key, { PK: 'USER#owner-a', SK: 'CASSETTE#tape-1' });
  const missing = mock(conditional(), {});
  await assert.rejects(missing.repository.remove('owner-a', 'tape-1', 1), CassetteMissing);
  const duplicate = mock(conditional());
  await assert.rejects(duplicate.repository.save('owner-a', request(), later), CassetteConflict);
  assert.equal(duplicate.commands.length, 1);
});

test('stored key/owner/schema mismatch and corrupt page keys fail closed', async () => {
  for (const broken of [
    { ...item(), PK: 'USER#owner-b' }, { ...item(), SK: 'CASSETTE#different' },
    { ...item(), revision: 0 }, { ...item(), extraOwner: 'leak' },
  ]) await assert.rejects(mock({ Item: broken }).repository.get('owner-a', 'tape-1'), CassetteCorrupt);
  await assert.rejects(mock({ Items: [], LastEvaluatedKey: { PK: 'USER#owner-b', SK: 'CASSETTE#tape-1' } }).repository.list('owner-a', 25), CassetteCorrupt);
});

test('service refuses unsafe revision increment and storage errors never switch to memory', async () => {
  const unavailable = mock(new Error('Dynamo unavailable'));
  const service = createCassettesService(unavailable.repository, createCassetteCursor('OFFLINE-ONLY-SECRET-012345678901234567890', 'offline'));
  await assert.rejects(service.get('owner-a', 'tape-1'), { status: 503 });
  assert.equal(unavailable.commands.length, 1);
  await assert.rejects(service.save('owner-a', 'tape-1', request(Number.MAX_SAFE_INTEGER)), { status: 400 });
});

test('private audio on stored reads is rejected in full instead of stripping or trusting object keys', async () => {
  const stored = item();
  stored.payload.tracks = [{ id: 'private', title: 'Private', artist: '', durationSec: 10, side: 'A', source: 'recording', provider: 's3', audio: { source: 'recording', objectKey: 'audio/foreign/file', contentType: 'audio/webm', sizeBytes: 20 } }];
  const service = createCassettesService(mock({ Item: stored }).repository, createCassetteCursor('OFFLINE-ONLY-SECRET-012345678901234567890', 'offline'));
  await assert.rejects(service.get('owner-a', 'tape-1'), { status: 422 });
});
