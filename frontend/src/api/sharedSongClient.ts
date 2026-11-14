import type { SharedSongPlaybackResponse } from '@runman/shared';
import type { MediaAccount } from './mediaClient';
import type { CassetteToken } from './cassetteClient';

export function createSharedSongApi(options: { baseUrl: string; account(): MediaAccount | null; token(): Promise<CassetteToken | null>; fetcher?: typeof fetch }) {
  return {
    async playback(id: string, signal: AbortSignal, cassetteId?: string): Promise<SharedSongPlaybackResponse> {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid shared song ID.');
      const account = options.account();
      const guard = () => {
        const current = options.account();
        if (signal.aborted || !account || !current || current.owner !== account.owner || current.generation !== account.generation) throw new DOMException('Playback canceled', 'AbortError');
      };
      guard(); const token = await options.token(); guard();
      if (!token || token.sub !== account!.owner || token.expiresAt <= Date.now() / 1000) throw new Error('Sign in again to play this shared song.');
      const query = cassetteId ? `?cassetteId=${encodeURIComponent(cassetteId)}` : '';
      const response = await (options.fetcher ?? fetch)(`${options.baseUrl}/api/explore/songs/${encodeURIComponent(id)}/playback${query}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token.token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store', credentials: 'omit',
      });
      const value: unknown = await response.json(); guard();
      if (!response.ok) throw new Error('This shared song is not available to this account.');
      if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') throw new Error('Invalid shared song playback response.');
      const url = new URL(value.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid shared song audio URL.');
      return { url: url.toString() };
    },
  };
}
