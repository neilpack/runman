// Reads and writes account data. The SDK boundary is injected so this runs in tests without AWS.
//
// Where each field lives today:
//   username        -> Cognito user pool attribute `preferred_username`
//   profile picture -> Cognito user pool attribute `picture` (a small compressed data URL)
//   password        -> Cognito (updatePassword; the old password is required)
//   favorite tape   -> DynamoDB profile item via /api/profile (USER#<sub> / PROFILE), cached in
//                      localStorage per account. When the server has no profile storage (503,
//                      e.g. local dev without AWS) it stays on this device only.

import {
  AVATAR_MAX_CHARS,
  fallbackUsername,
  isSafeAvatar,
  validateUsername,
  type AccountProfile,
  type TapeSnapshot,
} from './profileModel';

export interface AccountSdk {
  fetchUserAttributes(): Promise<Partial<Record<string, string>>>;
  updateUserAttributes(input: { userAttributes: Record<string, string> }): Promise<unknown>;
  deleteUserAttributes(input: { userAttributeKeys: ['picture'] }): Promise<void>;
  updatePassword(input: { oldPassword: string; newPassword: string }): Promise<void>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const FAVORITE_KEY = (userId: string) => `runman.profile.v1.${userId}.favoriteTape`;

/** Cloud copy of the profile settings. Matches api.profile (see api/profileClient.ts). */
export interface ProfileCloud {
  get(userId: string): Promise<{ favoriteTape: TapeSnapshot | null } | null>;
  save(userId: string, favoriteTape: TapeSnapshot | null): Promise<unknown>;
}

/** The server has no profile storage configured, so this device is the only copy. */
const cloudUnavailable = (error: unknown) =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 503;

function isSnapshot(value: unknown): value is TapeSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.shellColor === 'string' && Array.isArray(v.stickers);
}

export function createAccountService(sdk: AccountSdk, storage: KeyValueStorage | null, cloud?: ProfileCloud) {
  function readFavorite(userId: string): TapeSnapshot | null {
    try {
      const raw = storage?.getItem(FAVORITE_KEY(userId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeLocal(userId: string, tape: TapeSnapshot | null) {
    try {
      if (tape) storage?.setItem(FAVORITE_KEY(userId), JSON.stringify(tape));
      else storage?.removeItem(FAVORITE_KEY(userId));
    } catch { /* The cloud copy is the source of truth; the cache is best effort. */ }
  }

  async function loadFavorite(userId: string): Promise<TapeSnapshot | null> {
    const local = readFavorite(userId);
    if (!cloud) return local;
    try {
      const profile = await cloud.get(userId);
      if (profile) { writeLocal(userId, profile.favoriteTape); return profile.favoriteTape; }
      // First sign-in since favorites moved to the cloud: carry this device's pick over.
      if (local) void cloud.save(userId, local).catch(() => undefined);
      return local;
    } catch {
      return local;
    }
  }

  return {
    async load(userId: string): Promise<AccountProfile> {
      const [attrs, favoriteTape] = await Promise.all([sdk.fetchUserAttributes(), loadFavorite(userId)]);
      const email = attrs.email ?? '';
      const chosen = attrs.preferred_username?.trim() ?? '';
      const hasUsername = chosen.length > 0;
      return {
        userId,
        email,
        username: hasUsername ? chosen : fallbackUsername(email),
        hasUsername,
        avatar: isSafeAvatar(attrs.picture) ? attrs.picture : null,
        favoriteTape,
      };
    },

    async setUsername(raw: string): Promise<string> {
      const username = raw.trim();
      const problem = validateUsername(username);
      if (problem) throw Object.assign(new Error(problem), { name: 'ValidationError' });
      await sdk.updateUserAttributes({ userAttributes: { preferred_username: username } });
      return username;
    },

    async setAvatar(dataUrl: string): Promise<string> {
      if (!isSafeAvatar(dataUrl) || dataUrl.length > AVATAR_MAX_CHARS) {
        throw Object.assign(new Error('That picture could not be prepared. Try another image.'), { name: 'ValidationError' });
      }
      await sdk.updateUserAttributes({ userAttributes: { picture: dataUrl } });
      return dataUrl;
    },

    async removeAvatar(): Promise<void> {
      await sdk.deleteUserAttributes({ userAttributeKeys: ['picture'] });
    },

    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
      await sdk.updatePassword({ oldPassword, newPassword });
    },

    async setFavorite(userId: string, tape: TapeSnapshot | null): Promise<void> {
      let savedToCloud = false;
      if (cloud) {
        try { await cloud.save(userId, tape); savedToCloud = true; }
        catch (error) { if (!cloudUnavailable(error)) throw error; }
      }
      if (savedToCloud) { writeLocal(userId, tape); return; }
      if (!storage) throw Object.assign(new Error('Browser storage is unavailable.'), { name: 'StorageUnavailable' });
      if (tape) storage.setItem(FAVORITE_KEY(userId), JSON.stringify(tape));
      else storage.removeItem(FAVORITE_KEY(userId));
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
