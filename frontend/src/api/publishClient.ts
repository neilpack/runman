// Signed-in Explore publishing calls (/api/explore/mine/..., /api/explore/songs/:id/adds).

import type {
  CassettePayload, PublishProfileRequest, PublishProfileResponse, PublishSongRequest, PublishSongResponse,
  PublishTapeResponse, RecordSongAddResponse, UnpublishResponse,
} from '@runman/shared';
import type { CassetteToken } from './cassetteClient';

export class PublishApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) { super(message); this.name = 'PublishApiError'; }
}

export function createPublishApi(options: { baseUrl: string; accessToken(): Promise<CassetteToken | null>; fetcher?: typeof fetch }) {
  const fetcher = options.fetcher ?? fetch;
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const access = await options.accessToken().catch(() => null);
    if (!access?.token || access.expiresAt <= Date.now() / 1000) throw new PublishApiError(401, 'Sign in again to share on Explore.');
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl}/api/explore${path}`, {
        method, cache: 'no-store', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token}` },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new PublishApiError(0, 'Explore could not be reached. Check your connection and try again.');
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const record = json && typeof json === 'object' ? json as Record<string, unknown> : {};
      throw new PublishApiError(response.status, typeof record.error === 'string' ? record.error : `Explore request failed (${response.status}).`, record.details);
    }
    return json as T;
  }
  const tapePath = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new PublishApiError(400, 'Invalid cassette ID.');
    return `/mine/tapes/${encodeURIComponent(id)}`;
  };
  return {
    publishProfile: (input: PublishProfileRequest) => request<PublishProfileResponse>('PUT', '/mine/profile', input),
    publishSong: (input: PublishSongRequest) => request<PublishSongResponse>('PUT', '/mine/songs', input),
    unpublishSong: (objectKey: string) => request<UnpublishResponse>('DELETE', '/mine/songs', { objectKey }),
    publishTape: (cassette: CassettePayload) => request<PublishTapeResponse>('PUT', tapePath(cassette.id), { cassette }),
    unpublishTape: (cassetteId: string) => request<UnpublishResponse>('DELETE', tapePath(cassetteId)),
    recordAdd: (songId: string) => request<RecordSongAddResponse>('POST', `/songs/${encodeURIComponent(songId)}/adds`),
  };
}

export type PublishApi = ReturnType<typeof createPublishApi>;
