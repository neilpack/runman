import { validateProfileDocument, validateSaveProfileRequest, type ProfileDocument, type ProfileResponse } from '@runman/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { ProfileCorrupt } from '../aws/dynamoProfiles.js';
import type { ProfileRepository } from './profileRepository.js';

export function createProfileService(repository: ProfileRepository, clock = () => new Date().toISOString()) {
  async function storage<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof ProfileCorrupt) throw new HttpError(500, 'Profile storage returned an invalid record.');
      throw new HttpError(503, 'Profile storage is temporarily unavailable.');
    }
  }
  return {
    async get(owner: string): Promise<ProfileResponse> {
      return storage(async () => {
        const profile = await repository.get(owner);
        if (profile && !validateProfileDocument(profile).ok) throw new ProfileCorrupt();
        return { profile: profile ?? null };
      });
    },
    async save(owner: string, body: unknown): Promise<ProfileResponse> {
      const request = validateSaveProfileRequest(body);
      if (!request.ok) throw new HttpError(400, 'Invalid profile request.', request.issues);
      const profile: ProfileDocument = { schemaVersion: 1, updatedAt: clock(), favoriteTape: request.value.favoriteTape };
      return storage(async () => { await repository.put(owner, profile); return { profile }; });
    },
  };
}
