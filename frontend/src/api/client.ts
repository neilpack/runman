// Typed API client. All calls to the backend go through here.
import { fetchAuthSession } from 'aws-amplify/auth';
import { sessionStore } from '@/auth/session';
import { createCassetteApi } from './cassetteClient';

import type {
  CreateItemRequest,
  HealthResponse,
  Item,
  MusicSearchResponse,
} from '@runman/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
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
};
