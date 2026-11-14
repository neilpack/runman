import { createHmac, timingSafeEqual } from 'node:crypto';

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
interface CursorBody { v: 1; owner: string; query: string; limit: number; lastId: string }

export function createCassetteCursor(secret: string, context: string) {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Cursor secret must have at least 32 bytes.');
  const query = `${context}:cassette-id-asc:v1`;
  function signature(body: string) { return createHmac('sha256', secret).update(body).digest(); }
  return {
    encode(owner: string, limit: number, lastId: string) {
      if (!idPattern.test(owner) || !idPattern.test(lastId) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid cursor input.');
      const body = Buffer.from(JSON.stringify({ v: 1, owner, query, limit, lastId } satisfies CursorBody)).toString('base64url');
      const token = `${body}.${signature(body).toString('base64url')}`;
      if (token.length > 2048) throw new Error('Cursor is too large.');
      return token;
    },
    decode(token: string, owner: string, limit: number): string {
      if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid cursor.');
      const [body, encodedSignature] = token.split('.') as [string, string];
      const received = Buffer.from(encodedSignature, 'base64url');
      if (received.length !== 32 || received.toString('base64url') !== encodedSignature || !timingSafeEqual(received, signature(body))) throw new Error('Invalid cursor.');
      const bytes = Buffer.from(body, 'base64url');
      if (bytes.toString('base64url') !== body) throw new Error('Invalid cursor.');
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cursor.');
      const payload = value as Record<string, unknown>;
      if (Object.keys(payload).sort().join(',') !== 'lastId,limit,owner,query,v' || payload.v !== 1 || payload.owner !== owner || payload.query !== query || payload.limit !== limit || typeof payload.lastId !== 'string' || !idPattern.test(payload.lastId)) throw new Error('Invalid cursor.');
      return payload.lastId;
    },
  };
}
