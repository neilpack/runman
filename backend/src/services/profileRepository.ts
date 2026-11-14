import type { ProfileDocument } from '@runman/shared';

export interface ProfileRepository {
  get(owner: string): Promise<ProfileDocument | undefined>;
  put(owner: string, document: ProfileDocument): Promise<void>;
}

/** Explicit development backend only, like the memory cassette repository. */
export function createMemoryProfileRepository(): ProfileRepository {
  const profiles = new Map<string, ProfileDocument>();
  return {
    async get(owner) { return structuredClone(profiles.get(owner)); },
    async put(owner, document) { profiles.set(owner, structuredClone(document)); },
  };
}
