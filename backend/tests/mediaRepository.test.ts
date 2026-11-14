import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mediaObjectKey } from '@runman/shared';
import { createDynamoMediaRepository, type MediaDynamoCommand, type MediaDynamoResult } from '../src/aws/dynamoMedia.js';
import { createMemoryMediaRepository, MediaConflict, MediaCorrupt } from '../src/services/mediaRepository.js';
import type { PendingMedia, ReadyMedia } from '../src/services/mediaStorage.js';

const owner = 'owner-a'; const id = '11111111-1111-4111-8111-111111111111';
function pending(): PendingMedia { return { schemaVersion: 1, state: 'PENDING', PK: `USER#${owner}`, SK: `MEDIA#${id}`, owner, mediaId: id, objectKey: mediaObjectKey(owner, id), source: 'upload', sizeBytes: 12, contentType: 'audio/mpeg', sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', createdAt: '2026-11-14T01:00:00.000Z', expiresAt: '2026-11-14T01:05:00.000Z' }; }
function ready(): ReadyMedia { return { ...pending(), state: 'READY', versionId: 'version-1', completedAt: '2026-11-14T01:01:00.000Z' }; }
function conditional() { return Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }); }
function mock(...outputs: (MediaDynamoResult | Error)[]) {
  const commands: MediaDynamoCommand[] = [];
  const repository = createDynamoMediaRepository('OfflineTapes', async (command) => { commands.push(command); const output = outputs.shift(); assert.ok(output, 'Unexpected command'); if (output instanceof Error) throw output; return output; });
  return { repository, commands };
}

test('Dynamo media creates are conditional and reads strongly consistent owner-only MEDIA keys', async () => {
  const state = mock({}, { Item: { ...pending() } });
  await state.repository.create(pending()); await state.repository.get(owner, id);
  assert.ok(state.commands[0] instanceof PutCommand);
  assert.match(state.commands[0].input.ConditionExpression!, /attribute_not_exists/);
  assert.deepEqual(state.commands[0].input.Item, pending());
  assert.ok(state.commands[1] instanceof GetCommand);
  assert.equal(state.commands[1].input.ConsistentRead, true);
  assert.deepEqual(state.commands[1].input.Key, { PK: `USER#${owner}`, SK: `MEDIA#${id}` });
});

test('finalization condition protects PENDING exact immutable intent and never overwrites a READY winner', async () => {
  const winner = { ...ready(), versionId: 'winner-version' };
  const state = mock(conditional(), { Item: winner });
  assert.deepEqual(await state.repository.complete(ready()), winner);
  assert.ok(state.commands[0] instanceof PutCommand);
  const input = state.commands[0].input;
  assert.equal(input.ExpressionAttributeValues?.[':pending'], 'PENDING');
  assert.equal(input.ExpressionAttributeValues?.[':completed'], ready().completedAt);
  for (const field of ['source', 'sizeBytes', 'contentType', 'sha256', 'objectKey', 'createdAt', 'expiresAt', 'owner', 'mediaId']) assert.match(input.ConditionExpression!, new RegExp(`#${field} = :${field}`));
  assert.match(input.ConditionExpression!, /#expiresAt >= :completed/);
  assert.equal(state.commands.length, 2);
});

test('repository rejects corrupt/foreign records, immutable-intent mismatch and propagates storage failures', async () => {
  for (const input of [{ ...ready(), PK: 'USER#foreign' }, { ...ready(), objectKey: mediaObjectKey('foreign', id) }, { ...ready(), url: 'https://example.com' }]) {
    const state = mock({ Item: input }); await assert.rejects(state.repository.get(owner, id), MediaCorrupt);
  }
  const changed = mock(conditional(), { Item: { ...ready(), sizeBytes: 13 } });
  await assert.rejects(changed.repository.complete(ready()), MediaConflict);
  const missing = mock(conditional(), {}); await assert.rejects(missing.repository.complete(ready()), MediaConflict);
  const failure = mock(new Error('offline')); await assert.rejects(failure.repository.get(owner, id), /offline/);
});

test('offline repository isolates owners and returns detached immutable READY winners', async () => {
  const repository = createMemoryMediaRepository(); await repository.create(pending());
  await assert.rejects(repository.create(pending()), MediaConflict);
  assert.equal(await repository.get('owner-b', id), undefined);
  const first = await repository.complete(ready()); first.versionId = 'changed-outside';
  const second = await repository.complete({ ...ready(), versionId: 'later-version' });
  assert.equal(second.versionId, 'version-1');
  assert.equal((await repository.get(owner, id) as ReadyMedia).versionId, 'version-1');
});
