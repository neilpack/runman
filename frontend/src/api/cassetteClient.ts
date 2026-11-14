import { validateCassetteDocument } from '@runman/shared';
import type { CassetteDocument, CassetteResponse, DeleteCassetteResponse, ListCassettesResponse, SaveCassetteRequest } from '@runman/shared';

export class CassetteApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) { super(message); }
}

export interface CassetteApi {
  list(owner: string, options?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ListCassettesResponse>;
  get(owner: string, id: string, signal?: AbortSignal): Promise<CassetteResponse>;
  save(owner: string, input: SaveCassetteRequest, signal?: AbortSignal): Promise<CassetteResponse>;
  remove(owner: string, id: string, expectedRevision: number, signal?: AbortSignal): Promise<DeleteCassetteResponse>;
}

export interface CassetteToken { sub: string; token: string; expiresAt: number }
export function createCassetteApi(options: {
  baseUrl: string;
  currentOwner(): string | null;
  accessToken(): Promise<CassetteToken | null>;
  fetcher?: typeof fetch;
}): CassetteApi {
  const fetcher = options.fetcher ?? fetch;
  function assertCurrent(owner: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Request canceled.', 'AbortError');
    if (!owner || options.currentOwner() !== owner) throw new CassetteApiError(401, 'Sign in again before saving or loading your tapes.');
  }
  function path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new CassetteApiError(400, 'Invalid cassette ID.');
    return `/api/cassettes/${encodeURIComponent(id)}`;
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function malformed(): never { throw new CassetteApiError(502, 'The server returned an invalid cassette response. Your draft was kept.'); }
  function document(value: unknown): CassetteDocument {
    const checked = validateCassetteDocument(value);
    if (!checked.ok) return malformed();
    return checked.value;
  }
  async function request(owner: string, url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    assertCurrent(owner, signal);
    let access: CassetteToken | null;
    try { access = await options.accessToken(); }
    catch { throw new CassetteApiError(401, 'Your session could not be refreshed. Sign in again; your draft was kept.'); }
    assertCurrent(owner, signal);
    if (!access || access.sub !== owner || !Number.isFinite(access.expiresAt) || access.expiresAt <= Date.now() / 1000 || !access.token) {
      throw new CassetteApiError(401, 'Sign in again before saving or loading your tapes.');
    }
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl}${url}`, {
        ...init, signal, cache: 'no-store', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token}` },
      });
    } catch {
      assertCurrent(owner, signal);
      throw new CassetteApiError(0, 'The request could not be confirmed. Your local draft was kept. Refresh saved tapes before retrying.');
    }
    assertCurrent(owner, signal);
    const body: unknown = await response.json().catch(() => null);
    assertCurrent(owner, signal);
    if (!response.ok) {
      const message = record(body) && typeof body.error === 'string' && body.error.length <= 1000
        ? body.error : `Cassette request failed (${response.status}). Your draft was kept.`;
      throw new CassetteApiError(response.status, message, record(body) ? body.details : undefined);
    }
    return body;
  }
  return {
    async list(owner, input = {}, signal) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) query.set('limit', String(input.limit));
      if (input.cursor !== undefined) query.set('cursor', input.cursor);
      const body = await request(owner, `/api/cassettes${query.size ? `?${query}` : ''}`, { method: 'GET' }, signal);
      if (!record(body) || Object.keys(body).some((key) => !['items', 'nextCursor'].includes(key)) || !Array.isArray(body.items) || body.items.length > 100) return malformed();
      if (body.nextCursor !== undefined && (typeof body.nextCursor !== 'string' || !/^[a-zA-Z0-9_.~-]{1,2048}$/.test(body.nextCursor))) return malformed();
      const items = body.items.map(document);
      if (new Set(items.map((item) => item.payload.id)).size !== items.length) return malformed();
      return { items, ...(body.nextCursor !== undefined ? { nextCursor: body.nextCursor as string } : {}) };
    },
    async get(owner, id, signal) {
      const body = await request(owner, path(id), { method: 'GET' }, signal);
      if (!record(body) || Object.keys(body).join(',') !== 'cassette') return malformed();
      const cassette = document(body.cassette);
      if (cassette.payload.id !== id) return malformed();
      return { cassette };
    },
    async save(owner, input, signal) {
      const body = await request(owner, path(input.cassette.id), { method: 'PUT', body: JSON.stringify(input) }, signal);
      if (!record(body) || Object.keys(body).join(',') !== 'cassette') return malformed();
      const cassette = document(body.cassette);
      if (cassette.payload.id !== input.cassette.id || cassette.revision !== input.expectedRevision + 1) return malformed();
      return { cassette };
    },
    async remove(owner, id, expectedRevision, signal) {
      const body = await request(owner, path(id), { method: 'DELETE', body: JSON.stringify({ expectedRevision }) }, signal);
      if (!record(body) || Object.keys(body).sort().join(',') !== 'deletedRevision,id' || body.id !== id || body.deletedRevision !== expectedRevision) return malformed();
      return { id, deletedRevision: expectedRevision };
    },
  };
}
