// Typed API client. All calls to the backend go through here.

import type { CreateItemRequest, HealthResponse, Item } from '@runman/shared';

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
  health: () => request<HealthResponse>('/api/health'),
  listItems: () => request<Item[]>('/api/items'),
  createItem: (input: CreateItemRequest) =>
    request<Item>('/api/items', { method: 'POST', body: JSON.stringify(input) }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
};
