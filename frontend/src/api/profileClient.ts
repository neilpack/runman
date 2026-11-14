import { validateProfileDocument, type ProfileDocument, type ProfileResponse, type TapeSnapshot } from '@runman/shared';
import type { CassetteToken } from './cassetteClient';

/** `status` 503 means the server has no profile storage configured (e.g. local dev without AWS). */
export class ProfileApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ProfileApiError'; }
}

export interface ProfileApi {
  get(owner: string): Promise<ProfileDocument | null>;
  save(owner: string, favoriteTape: TapeSnapshot | null): Promise<ProfileDocument>;
}

export function createProfileApi(options: { baseUrl: string; accessToken(): Promise<CassetteToken | null>; fetcher?: typeof fetch }): ProfileApi {
  const fetcher = options.fetcher ?? fetch;
  async function request(owner: string, init: RequestInit): Promise<ProfileDocument | null> {
    const access = await options.accessToken().catch(() => null);
    if (!access || access.sub !== owner || access.expiresAt <= Date.now() / 1000) throw new ProfileApiError(401, 'Sign in again to update your profile.');
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl}/api/profile`, {
        ...init, cache: 'no-store', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token}` },
      });
    } catch {
      throw new ProfileApiError(0, 'Your profile could not be reached. Check your connection and try again.');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Profile request failed (${response.status}).`;
      throw new ProfileApiError(response.status, message);
    }
    const profile = body && typeof body === 'object' && 'profile' in body ? (body as ProfileResponse).profile : undefined;
    if (profile === null) return null;
    const checked = validateProfileDocument(profile);
    if (!checked.ok) throw new ProfileApiError(502, 'The server returned an invalid profile.');
    return checked.value;
  }
  return {
    get: (owner) => request(owner, { method: 'GET' }),
    async save(owner, favoriteTape) {
      const saved = await request(owner, { method: 'PUT', body: JSON.stringify({ favoriteTape }) });
      if (!saved) throw new ProfileApiError(502, 'The server returned an invalid profile.');
      return saved;
    },
  };
}
