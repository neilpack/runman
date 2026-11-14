// Typed API client. All calls to the backend go through here.
import { fetchAuthSession } from 'aws-amplify/auth';
import { sessionStore } from '@/auth/session';
import { createCassetteApi } from './cassetteClient';
import { createMediaApi } from './mediaClient';
import { getMediaAccount } from '@/auth/mediaContext';

import type {
  CreateItemRequest,
  HealthResponse,
  Item,
  ListenerProfileResponse,
  ListenerSearchResponse,
  MusicSearchResponse,
  PublicSongPage,
  TrendingSongsResponse,
} from '@runman/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/** Thrown for non-2xx responses; `status` lets callers tell "not found" from "server down". */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiRequestError(body.error ?? `Request failed: ${res.status}`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  media: createMediaApi({
    baseUrl: BASE_URL,
    currentAccount: getMediaAccount,
    async accessToken() {
      const access = (await fetchAuthSession()).tokens?.accessToken;
      return access && typeof access.payload.sub === 'string' && typeof access.payload.exp === 'number'
        ? { sub: access.payload.sub, token: access.toString(), expiresAt: access.payload.exp } : null;
    },
  }),
  cassettes: createCassetteApi({
    baseUrl: BASE_URL,
    currentOwner() {
      const session = sessionStore.getSnapshot();
      return session.status === 'signedIn' ? session.user?.userId ?? null : null;
    },
    async accessToken() {
      const access = (await fetchAuthSession()).tokens?.accessToken;
      return access && typeof access.payload.sub === 'string' && typeof access.payload.exp === 'number'
        ? { sub: access.payload.sub, token: access.toString(), expiresAt: access.payload.exp } : null;
    },
  }),
  health: () => request<HealthResponse>('/api/health'),
  listItems: () => request<Item[]>('/api/items'),
  createItem: (input: CreateItemRequest) =>
    request<Item>('/api/items', { method: 'POST', body: JSON.stringify(input) }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  searchMusic: (query: string, options?: { limit?: number; offset?: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: query });
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    return request<MusicSearchResponse>(`/api/music/search?${params.toString()}`, { signal });
  },

  // Explore: public songs and listener profiles.
  exploreSongs: (params: { q?: string; limit?: number; offset?: number }, signal?: AbortSignal) =>
    request<PublicSongPage>(`/api/explore/songs${query(params)}`, { signal }),
  trendingSongs: (signal?: AbortSignal) => request<TrendingSongsResponse>('/api/explore/songs/trending', { signal }),
  searchListeners: (q: string, signal?: AbortSignal) =>
    request<ListenerSearchResponse>(`/api/explore/profiles${query({ q })}`, { signal }),
  listener: (username: string, signal?: AbortSignal) =>
    request<ListenerProfileResponse>(`/api/explore/profiles/${encodeURIComponent(username)}`, { signal }),
  /** Stable, storable audio URL for a public song (the server redirects to a fresh S3 link). */
  publicSongAudioUrl: (songId: string) => `${BASE_URL}/api/explore/songs/${encodeURIComponent(songId)}/audio`,
};
