import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateProfileDocument, type ProfileDocument } from '@runman/shared';
import { dynamo } from './clients.js';
import type { ProfileRepository } from '../services/profileRepository.js';

export class ProfileCorrupt extends Error {}
export type ProfileDynamoCommand = GetCommand | PutCommand;
export interface ProfileDynamoResult { Item?: Record<string, unknown>; $metadata?: unknown }

async function sendDynamo(command: ProfileDynamoCommand): Promise<ProfileDynamoResult> {
  if (command instanceof GetCommand) return dynamo.send(command);
  return dynamo.send(command);
}

/** One item per user in the cassettes table: PK `USER#<sub>`, SK `PROFILE`. */
export function createDynamoProfileRepository(tableName: string, send: (command: ProfileDynamoCommand) => Promise<ProfileDynamoResult> = sendDynamo): ProfileRepository {
  function key(owner: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new ProfileCorrupt();
    return { PK: `USER#${owner}`, SK: 'PROFILE' };
  }
  return {
    async get(owner) {
      const output = await send(new GetCommand({ TableName: tableName, Key: key(owner), ConsistentRead: true }));
      if (!output.Item) return undefined;
      const { PK, SK, ...document } = output.Item;
      if (PK !== `USER#${owner}` || SK !== 'PROFILE') throw new ProfileCorrupt();
      const checked = validateProfileDocument(document);
      if (!checked.ok) throw new ProfileCorrupt();
      return checked.value;
    },
    async put(owner, document: ProfileDocument) {
      await send(new PutCommand({ TableName: tableName, Item: { ...key(owner), ...document } }));
    },
  };
}
