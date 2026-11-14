// Explore catalog rows in the cassettes table. Layout: shared/src/explorePublishing.ts.
// Every listing is a Query on a fixed partition; nothing here ever Scans the table.

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { PublicTape } from '@runman/shared';
import { dynamo } from './clients.js';
import {
  CatalogConflict, CatalogCorrupt, UsernameTaken, checkedProfile, checkedSong, checkedTape,
  type PublicCatalogRepository, type PublicProfileItem, type PublicSongItem,
} from '../services/publicCatalogRepository.js';

export type CatalogDynamoCommand = GetCommand | PutCommand | UpdateCommand | DeleteCommand | QueryCommand | TransactWriteCommand;
export interface CatalogDynamoResult {
  Item?: Record<string, unknown>;
  Items?: Record<string, unknown>[];
  Attributes?: Record<string, unknown>;
  LastEvaluatedKey?: Record<string, unknown>;
  $metadata?: unknown;
}

async function sendDynamo(command: CatalogDynamoCommand): Promise<CatalogDynamoResult> {
  if (command instanceof GetCommand) return dynamo.send(command);
  if (command instanceof PutCommand) return dynamo.send(command);
  if (command instanceof UpdateCommand) return dynamo.send(command);
  if (command instanceof DeleteCommand) return dynamo.send(command);
  if (command instanceof TransactWriteCommand) return dynamo.send(command);
  return dynamo.send(command);
}

export const CATALOG_PARTITIONS = { song: 'EXPLORE#SONG', tape: 'EXPLORE#TAPE', profile: 'EXPLORE#PROFILE', username: 'EXPLORE#USERNAME' } as const;
/** Hackathon-sized catalog: stop reading a partition after this many rows. */
const MAX_ROWS = 2000;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;

const conditionFailed = (error: unknown) => error instanceof Error && error.name === 'ConditionalCheckFailedException';
/** Per-item reasons of a cancelled transaction, in request order. */
function cancellation(error: unknown): string[] | undefined {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return undefined;
  const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  return reasons.map((reason) => reason.Code ?? 'None');
}

export function createDynamoPublicCatalogRepository(tableName: string, send: (command: CatalogDynamoCommand) => Promise<CatalogDynamoResult> = sendDynamo): PublicCatalogRepository {
  function sk(value: string) {
    if (!ID.test(value)) throw new CatalogCorrupt();
    return value;
  }
  function strip(partition: string, item: Record<string, unknown>) {
    const { PK, SK, ...rest } = item;
    if (PK !== partition || typeof SK !== 'string') throw new CatalogCorrupt();
    return { SK, rest };
  }
  async function query(partition: string) {
    const rows: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const output = await send(new QueryCommand({
        TableName: tableName, KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'PK' }, ExpressionAttributeValues: { ':pk': partition },
        ...(start ? { ExclusiveStartKey: start } : {}),
      }));
      rows.push(...(output.Items ?? []));
      start = output.LastEvaluatedKey && Object.keys(output.LastEvaluatedKey).length ? output.LastEvaluatedKey : undefined;
    } while (start && rows.length < MAX_ROWS);
    return rows.slice(0, MAX_ROWS);
  }
  /** Listings skip (and log) a bad row instead of failing the whole Explore page. */
  function lenient<T>(rows: Record<string, unknown>[], partition: string, decode: (sk: string, rest: Record<string, unknown>) => T): T[] {
    return rows.flatMap((row) => {
      try { const { SK, rest } = strip(partition, row); return [decode(SK, rest)]; }
      catch { console.warn(`[explore] skipped invalid ${partition} row`); return []; }
    });
  }
  const song = (id: string, rest: Record<string, unknown>) => { const item = checkedSong(rest); if (item.id !== id) throw new CatalogCorrupt(); return item; };
  const tape = (id: string, rest: Record<string, unknown>) => { const item = checkedTape(rest); if (item.id !== id) throw new CatalogCorrupt(); return item; };
  const profile = (id: string, rest: Record<string, unknown>) => { const item = checkedProfile(rest); if (item.userId !== id) throw new CatalogCorrupt(); return item; };

  async function getOne<T>(partition: string, id: string, decode: (sk: string, rest: Record<string, unknown>) => T): Promise<T | undefined> {
    const output = await send(new GetCommand({ TableName: tableName, Key: { PK: partition, SK: sk(id) }, ConsistentRead: true }));
    if (!output.Item) return undefined;
    const { SK, rest } = strip(partition, output.Item);
    return decode(SK, rest);
  }
  /** `ownerPath` is the attribute path holding the owner, e.g. ['ownerId'] or ['owner', 'userId']. */
  async function deleteOwned(partition: string, id: string, ownerPath: string[], owner: string) {
    const names: Record<string, string> = { '#pk': 'PK' };
    ownerPath.forEach((part, index) => { names[`#p${index}`] = part; });
    try {
      await send(new DeleteCommand({
        TableName: tableName, Key: { PK: partition, SK: sk(id) },
        ConditionExpression: `attribute_exists(#pk) AND ${ownerPath.map((_, index) => `#p${index}`).join('.')} = :owner`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ':owner': owner },
      }));
      return true;
    } catch (error) {
      if (conditionFailed(error)) return false;
      throw error;
    }
  }

  return {
    async listSongs() { return lenient(await query(CATALOG_PARTITIONS.song), CATALOG_PARTITIONS.song, song); },
    async listTapes() { return lenient(await query(CATALOG_PARTITIONS.tape), CATALOG_PARTITIONS.tape, tape); },
    async listProfiles() { return lenient(await query(CATALOG_PARTITIONS.profile), CATALOG_PARTITIONS.profile, profile); },
    getSong: (id) => getOne(CATALOG_PARTITIONS.song, id, song),
    getTape: (id) => getOne(CATALOG_PARTITIONS.tape, id, tape),
    getProfile: (owner) => getOne(CATALOG_PARTITIONS.profile, owner, profile),

    async putSong(input, now): Promise<PublicSongItem> {
      const fields: Record<string, unknown> = { ownerId: input.ownerId, uploaderUsername: input.uploaderUsername, title: input.title, artist: input.artist, durationSec: input.durationSec, audio: input.audio, updatedAt: now, id: input.id };
      const names: Record<string, string> = { '#pk': 'PK', '#publishedAt': 'publishedAt', '#addCount': 'addCount', '#artworkUrl': 'artworkUrl', '#listed': 'listed' };
      const values: Record<string, unknown> = { ':now': now, ':zero': 0, ':listed': input.listed };
      const sets = Object.keys(fields).map((key) => { names[`#${key}`] = key; values[`:${key}`] = fields[key]; return `#${key} = :${key}`; });
      sets.push('#publishedAt = if_not_exists(#publishedAt, :now)', '#addCount = if_not_exists(#addCount, :zero)',
        // Sharing the song lists it; a tape upsert keeps whatever it was (unlisted when new).
        input.listed ? '#listed = :listed' : '#listed = if_not_exists(#listed, :listed)');
      if (input.artworkUrl !== undefined) { sets.push('#artworkUrl = :artworkUrl'); values[':artworkUrl'] = input.artworkUrl; }
      try {
        const output = await send(new UpdateCommand({
          TableName: tableName, Key: { PK: CATALOG_PARTITIONS.song, SK: sk(input.id) },
          UpdateExpression: `SET ${sets.join(', ')}${input.artworkUrl === undefined ? ' REMOVE #artworkUrl' : ''}`,
          ConditionExpression: 'attribute_not_exists(#pk) OR #ownerId = :ownerId',
          ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
        }));
        if (!output.Attributes) throw new CatalogCorrupt();
        const { SK, rest } = strip(CATALOG_PARTITIONS.song, output.Attributes);
        return song(SK, rest);
      } catch (error) {
        if (conditionFailed(error)) throw new CatalogConflict();
        throw error;
      }
    },
    deleteSong: (id, owner) => deleteOwned(CATALOG_PARTITIONS.song, id, ['ownerId'], owner),
    async unlistSong(id, owner, now) {
      try {
        await send(new UpdateCommand({
          TableName: tableName, Key: { PK: CATALOG_PARTITIONS.song, SK: sk(id) },
          UpdateExpression: 'SET #listed = :false, #updatedAt = :now',
          ConditionExpression: 'attribute_exists(#pk) AND #ownerId = :owner',
          ExpressionAttributeNames: { '#pk': 'PK', '#listed': 'listed', '#updatedAt': 'updatedAt', '#ownerId': 'ownerId' },
          ExpressionAttributeValues: { ':false': false, ':now': now, ':owner': owner },
        }));
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },

    async putTape(input, now): Promise<PublicTape> {
      const previous = await getOne(CATALOG_PARTITIONS.tape, input.id, tape);
      if (previous && previous.owner.userId !== input.owner.userId) throw new CatalogConflict();
      const item = checkedTape({ ...input, publishedAt: previous?.publishedAt ?? now, updatedAt: now });
      try {
        await send(new PutCommand({
          TableName: tableName, Item: { PK: CATALOG_PARTITIONS.tape, SK: sk(item.id), ...item },
          ConditionExpression: previous ? '#o.#u = :owner AND #publishedAt = :publishedAt' : 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: previous ? { '#o': 'owner', '#u': 'userId', '#publishedAt': 'publishedAt' } : { '#pk': 'PK' },
          ...(previous ? { ExpressionAttributeValues: { ':owner': input.owner.userId, ':publishedAt': previous.publishedAt } } : {}),
        }));
      } catch (error) {
        if (conditionFailed(error)) throw new CatalogConflict();
        throw error;
      }
      return item;
    },
    deleteTape: (id, owner) => deleteOwned(CATALOG_PARTITIONS.tape, id, ['owner', 'userId'], owner),

    async putProfile(owner, input, now, ifPublished): Promise<PublicProfileItem | undefined> {
      const previous = await getOne(CATALOG_PARTITIONS.profile, owner, profile);
      if (ifPublished && !previous) return undefined;
      const item = checkedProfile({ userId: owner, ...input, updatedAt: now });
      const claim = item.username.toLowerCase();
      const oldClaim = previous?.username.toLowerCase();
      const items: NonNullable<TransactWriteCommand['input']['TransactItems']> = [
        { Put: {
          TableName: tableName, Item: { PK: CATALOG_PARTITIONS.username, SK: claim, ownerId: owner },
          ConditionExpression: 'attribute_not_exists(#pk) OR #ownerId = :owner',
          ExpressionAttributeNames: { '#pk': 'PK', '#ownerId': 'ownerId' }, ExpressionAttributeValues: { ':owner': owner },
        } },
        { Put: {
          TableName: tableName, Item: { PK: CATALOG_PARTITIONS.profile, SK: sk(owner), ...item },
          // Optimistic check against the profile we read, so concurrent renames can't leak a claim.
          ConditionExpression: previous ? '#username = :previous' : 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: previous ? { '#username': 'username' } : { '#pk': 'PK' },
          ...(previous ? { ExpressionAttributeValues: { ':previous': previous.username } } : {}),
        } },
      ];
      if (oldClaim !== undefined && oldClaim !== claim) items.push({ Delete: {
        TableName: tableName, Key: { PK: CATALOG_PARTITIONS.username, SK: oldClaim },
        ConditionExpression: '#ownerId = :owner', ExpressionAttributeNames: { '#ownerId': 'ownerId' }, ExpressionAttributeValues: { ':owner': owner },
      } });
      try {
        await send(new TransactWriteCommand({ TransactItems: items }));
      } catch (error) {
        const reasons = cancellation(error);
        if (reasons?.[0] === 'ConditionalCheckFailed') throw new UsernameTaken();
        if (reasons) throw new CatalogConflict();
        throw error;
      }
      return item;
    },

    async recordAdd(songId, listener) {
      const key = { PK: CATALOG_PARTITIONS.song, SK: sk(songId) };
      try {
        await send(new TransactWriteCommand({ TransactItems: [
          { Put: {
            TableName: tableName, Item: { PK: `EXPLORE#ADD#${songId}`, SK: sk(listener) },
            ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'PK' },
          } },
          { Update: {
            TableName: tableName, Key: key, UpdateExpression: 'ADD #addCount :one',
            ConditionExpression: 'attribute_exists(#pk)', ExpressionAttributeNames: { '#pk': 'PK', '#addCount': 'addCount' }, ExpressionAttributeValues: { ':one': 1 },
          } },
        ] }));
      } catch (error) {
        const reasons = cancellation(error);
        if (!reasons) throw error;
        if (reasons[1] === 'ConditionalCheckFailed') return undefined;
        if (reasons[0] !== 'ConditionalCheckFailed') throw new CatalogConflict();
        // Already counted for this listener: report the current total.
      }
      return (await getOne(CATALOG_PARTITIONS.song, songId, song))?.addCount;
    },
  };
}
