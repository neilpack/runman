import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { validateCassetteDocument, type CassetteDocument } from '@runman/shared';
import { dynamo } from './clients.js';
import { CassetteConflict, CassetteMissing, type CassetteRepository } from '../services/cassetteRepository.js';

export class CassetteCorrupt extends Error {}
export type CassetteDynamoCommand = GetCommand | PutCommand | UpdateCommand | DeleteCommand | QueryCommand;
export interface CassetteDynamoResult {
  Item?: Record<string, unknown>;
  Items?: Record<string, unknown>[];
  Attributes?: Record<string, unknown>;
  LastEvaluatedKey?: Record<string, unknown>;
  $metadata?: unknown;
}

async function sendDynamo(command: CassetteDynamoCommand): Promise<CassetteDynamoResult> {
  if (command instanceof GetCommand) return dynamo.send(command);
  if (command instanceof PutCommand) return dynamo.send(command);
  if (command instanceof UpdateCommand) return dynamo.send(command);
  if (command instanceof DeleteCommand) return dynamo.send(command);
  return dynamo.send(command);
}

export function createDynamoCassetteRepository(tableName: string, send: (command: CassetteDynamoCommand) => Promise<CassetteDynamoResult> = sendDynamo): CassetteRepository {
  const prefix = 'CASSETTE#';
  function keys(owner: string, id: string) {
    if (![owner, id].every((value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value))) throw new CassetteCorrupt();
    return { PK: `USER#${owner}`, SK: `${prefix}${id}` };
  }
  function decode(owner: string, item: Record<string, unknown>, expectedId?: string): CassetteDocument {
    const { PK, SK, ...document } = item;
    if (PK !== `USER#${owner}` || typeof SK !== 'string' || !SK.startsWith(prefix)) throw new CassetteCorrupt();
    const id = SK.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || (expectedId !== undefined && id !== expectedId)) throw new CassetteCorrupt();
    const checked = validateCassetteDocument(document);
    if (!checked.ok || checked.value.payload.id !== id) throw new CassetteCorrupt();
    return checked.value;
  }
  const repository: CassetteRepository = {
    async get(owner, id) {
      const output = await send(new GetCommand({ TableName: tableName, Key: keys(owner, id), ConsistentRead: true }));
      return output.Item ? decode(owner, output.Item, id) : undefined;
    },
    async list(owner, limit, afterId) {
      const output = await send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#pk = :owner AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        ExpressionAttributeValues: { ':owner': `USER#${owner}`, ':prefix': prefix },
        Limit: limit, ScanIndexForward: true, ConsistentRead: true,
        ...(afterId ? { ExclusiveStartKey: keys(owner, afterId) } : {}),
      }));
      const items = (output.Items ?? []).map((item) => decode(owner, item));
      let next: string | undefined;
      const key = output.LastEvaluatedKey;
      if (key && Object.keys(key).length) {
        if (Object.keys(key).sort().join(',') !== 'PK,SK' || key.PK !== `USER#${owner}` || typeof key.SK !== 'string' || !key.SK.startsWith(prefix)) throw new CassetteCorrupt();
        next = key.SK.slice(prefix.length);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(next)) throw new CassetteCorrupt();
      }
      return { items, ...(next ? { afterId: next } : {}) };
    },
    async save(owner, request, now) {
      const key = keys(owner, request.cassette.id);
      try {
        if (request.expectedRevision === 0) {
          const document: CassetteDocument = { schemaVersion: 1, revision: 1, createdAt: now, updatedAt: now, payload: request.cassette };
          await send(new PutCommand({
            TableName: tableName, Item: { ...key, ...document },
            ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
            ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
          }));
          return structuredClone(document);
        }
        const output = await send(new UpdateCommand({
          TableName: tableName, Key: key,
          UpdateExpression: 'SET #payload = :payload, #revision = :next, #updatedAt = :now',
          ConditionExpression: 'attribute_exists(#pk) AND #revision = :expected AND #schema = :schema AND attribute_exists(#createdAt)',
          ExpressionAttributeNames: { '#pk': 'PK', '#payload': 'payload', '#revision': 'revision', '#updatedAt': 'updatedAt', '#schema': 'schemaVersion', '#createdAt': 'createdAt' },
          ExpressionAttributeValues: { ':payload': request.cassette, ':next': request.expectedRevision + 1, ':expected': request.expectedRevision, ':now': now, ':schema': 1 },
          ReturnValues: 'ALL_NEW',
        }));
        if (!output.Attributes) throw new CassetteCorrupt();
        return decode(owner, output.Attributes, request.cassette.id);
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          if (request.expectedRevision > 0 && !await repository.get(owner, request.cassette.id)) throw new CassetteMissing();
          throw new CassetteConflict();
        }
        throw error;
      }
    },
    async remove(owner, id, revision) {
      try {
        await send(new DeleteCommand({
          TableName: tableName, Key: keys(owner, id),
          ConditionExpression: 'attribute_exists(#pk) AND #revision = :expected',
          ExpressionAttributeNames: { '#pk': 'PK', '#revision': 'revision' },
          ExpressionAttributeValues: { ':expected': revision },
        }));
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          if (!await repository.get(owner, id)) throw new CassetteMissing();
          throw new CassetteConflict();
        }
        throw error;
      }
    },
  };
  return repository;
}
