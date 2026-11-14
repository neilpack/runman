import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from './clients.js';
import { checkedListeningSession, checkedListeningStats, listeningSongKey, type ListeningRepository, type ListeningSession } from '../services/listeningRepository.js';

export type ListeningCommand = GetCommand | PutCommand | QueryCommand | TransactWriteCommand;
export interface ListeningResult { Item?: Record<string, unknown>; Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown>; $metadata?: unknown }
async function send(command: ListeningCommand): Promise<ListeningResult> {
  if (command instanceof GetCommand) return dynamo.send(command);
  if (command instanceof PutCommand) return dynamo.send(command);
  if (command instanceof QueryCommand) return dynamo.send(command);
  return dynamo.send(command);
}
export function createDynamoListeningRepository(table: string, execute = send): ListeningRepository {
  const key = (owner: string, playId: string) => ({ PK: `USER#${owner}`, SK: `LISTEN#${playId}` });
  async function get(owner: string, playId: string) {
    const result = await execute(new GetCommand({ TableName: table, Key: key(owner, playId), ConsistentRead: true }));
    if (!result.Item) return;
    const { PK, SK, ...data } = result.Item;
    if (PK !== `USER#${owner}` || SK !== `LISTEN#${playId}` || data.owner !== owner || data.playId !== playId) throw new Error('Listening owner mismatch');
    return checkedListeningSession(data);
  }
  return {
    get,
    async start(session) {
      const data = checkedListeningSession(session);
      try { await execute(new PutCommand({ TableName: table, Item: { ...key(data.owner, data.playId), ...data }, ConditionExpression: 'attribute_not_exists(PK)' })); return data; }
      catch (error) { if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error; const previous = await get(data.owner, data.playId); if (!previous) throw error; return previous; }
    },
    async advance(previous, next) {
      checkedListeningSession(next);
      const increment = Number(!previous.counted && next.counted); const delta = next.listenedMs - previous.listenedMs;
      try {
        await execute(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: table, Item: { ...key(next.owner, next.playId), ...next }, ConditionExpression: '#revision = :revision', ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':revision': previous.revision } } },
          { Update: { TableName: table, Key: { PK: 'DISCOVER#STATS', SK: listeningSongKey(next.song) },
            UpdateExpression: 'SET #song = :song ADD #plays :plays, #ms :ms',
            ConditionExpression: '(attribute_not_exists(#plays) OR #plays <= :maxPlays) AND (attribute_not_exists(#ms) OR #ms <= :maxMs)',
            ExpressionAttributeNames: { '#song': 'song', '#plays': 'playCount', '#ms': 'listenedMs' },
            ExpressionAttributeValues: { ':song': next.song, ':plays': increment, ':ms': delta, ':maxPlays': Number.MAX_SAFE_INTEGER - increment, ':maxMs': Number.MAX_SAFE_INTEGER - delta } } },
        ] })); return true;
      } catch (error) {
        const reasons = (error as { name?: string; CancellationReasons?: { Code?: string }[] });
        if (reasons.name === 'TransactionCanceledException' && reasons.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed' && reasons.CancellationReasons?.[1]?.Code === 'None') return false;
        throw error;
      }
    },
    async listStats() {
      const rows = []; let start: Record<string, unknown> | undefined;
      do {
        const result = await execute(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'DISCOVER#STATS' }, ...(start ? { ExclusiveStartKey: start } : {}) }));
        for (const item of result.Items ?? []) { const { PK, SK, ...data } = item; const row = checkedListeningStats(data); if (PK !== 'DISCOVER#STATS' || SK !== listeningSongKey(row.song)) throw new Error('Invalid statistics key'); rows.push(row); }
        start = result.LastEvaluatedKey;
      } while (start && Object.keys(start).length && rows.length < 2000);
      return rows.slice(0, 2000);
    },
  };
}
