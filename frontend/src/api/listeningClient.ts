import type { ListeningProgressResponse, ListeningSelector, StartListeningResponse } from '@runman/shared';
import type { MediaAccount } from './mediaClient';
import type { CassetteToken } from './cassetteClient';
export interface ListeningApi {
  start(account: MediaAccount, playId: string, song: ListeningSelector, signal: AbortSignal): Promise<StartListeningResponse>;
  progress(account: MediaAccount, playId: string, listenedMs: number, signal: AbortSignal): Promise<ListeningProgressResponse>;
}
export function createListeningApi(options: { baseUrl: string; account(): MediaAccount | null; token(): Promise<CassetteToken | null>; fetcher?: typeof fetch }): ListeningApi {
  function current(account: MediaAccount, signal: AbortSignal) {
    const next = options.account(); if (signal.aborted || !next || next.owner !== account.owner || next.generation !== account.generation) throw new DOMException('Listening canceled', 'AbortError');
  }
  async function request(account: MediaAccount, path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    current(account, signal); const token = await options.token(); current(account, signal);
    if (!token || token.sub !== account.owner || token.expiresAt <= Date.now() / 1000) throw new Error('Listening requires a current session');
    const response = await (options.fetcher ?? fetch)(`${options.baseUrl}/api/explore/plays/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store', credentials: 'omit' });
    const value: unknown = await response.json(); current(account, signal);
    if (!response.ok) throw new Error('Listening update was not confirmed');
    return value;
  }
  return {
    async start(account, playId, song, signal) {
      const value = await request(account, 'start', { playId, song }, signal) as StartListeningResponse;
      if (!value || typeof value.eligible !== 'boolean') throw new Error('Invalid listening response'); return value;
    },
    async progress(account, playId, listenedMs, signal) {
      const value = await request(account, 'progress', { playId, listenedMs }, signal) as ListeningProgressResponse;
      if (!value || typeof value.counted !== 'boolean' || !Number.isSafeInteger(value.listenedMs) || value.listenedMs < 0) throw new Error('Invalid listening response'); return value;
    },
  };
}
