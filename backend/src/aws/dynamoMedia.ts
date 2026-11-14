import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mediaObjectKey } from '@runman/shared';
import { dynamo } from './clients.js';
import { checkedMedia, MediaConflict, MediaCorrupt, sameMediaIntent, type MediaRepository } from '../services/mediaRepository.js';
import type { ReadyMedia } from '../services/mediaStorage.js';

export type MediaDynamoCommand = GetCommand | PutCommand;
export interface MediaDynamoResult { Item?: Record<string, unknown>; $metadata?: unknown }
async function sendDynamo(command: MediaDynamoCommand): Promise<MediaDynamoResult> {
  if (command instanceof GetCommand) return dynamo.send(command);
  return dynamo.send(command);
}
export function createDynamoMediaRepository(tableName: string, send: (command: MediaDynamoCommand) => Promise<MediaDynamoResult> = sendDynamo): MediaRepository {
  const repository: MediaRepository = {
    async get(owner, mediaId) {
      mediaObjectKey(owner, mediaId);
      const output = await send(new GetCommand({ TableName: tableName, Key: { PK: `USER#${owner}`, SK: `MEDIA#${mediaId}` }, ConsistentRead: true }));
      return output.Item ? checkedMedia(output.Item, owner, mediaId) : undefined;
    },
    async create(input) {
      const record = checkedMedia(input);
      if (record.state !== 'PENDING') throw new MediaCorrupt();
      try {
        await send(new PutCommand({ TableName: tableName, Item: record, ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)', ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' } }));
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') throw new MediaConflict();
        throw error;
      }
    },
    async complete(input) {
      const record = checkedMedia(input);
      if (record.state !== 'READY') throw new MediaCorrupt();
      const fields = ['schemaVersion', 'owner', 'mediaId', 'objectKey', 'source', 'contentType', 'sizeBytes', 'sha256', 'createdAt', 'expiresAt'] as const;
      const names: Record<string, string> = { '#state': 'state', '#version': 'versionId' };
      const values: Record<string, unknown> = { ':pending': 'PENDING', ':completed': record.completedAt };
      const conditions = ['#state = :pending', 'attribute_not_exists(#version)'];
      for (const field of fields) { names[`#${field}`] = field; values[`:${field}`] = record[field]; conditions.push(`#${field} = :${field}`); }
      conditions.push('#expiresAt >= :completed');
      try {
        await send(new PutCommand({ TableName: tableName, Item: record, ConditionExpression: conditions.join(' AND '), ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
        return record;
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          const winner = await repository.get(record.owner, record.mediaId);
          if (winner?.state === 'READY' && sameMediaIntent(winner, record)) return winner as ReadyMedia;
          throw new MediaConflict();
        }
        throw error;
      }
    },
  };
  return repository;
}
