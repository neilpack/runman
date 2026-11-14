// Reads and writes account data. The SDK boundary is injected so this runs in tests without AWS.
//
// Where each field lives today:
//   username        -> Cognito user pool attribute `preferred_username`
//   profile picture -> Cognito user pool attribute `picture` (a small compressed data URL)
//   password        -> Cognito (updatePassword; the old password is required)
//   favorite tape   -> this device (localStorage), per account. Cassettes themselves are still
//                      local-only; when a profiles/cassettes API exists, swap the two favorite
//                      functions below for API calls and other listeners can read it.

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

function isSnapshot(value: unknown): value is TapeSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.shellColor === 'string' && Array.isArray(v.stickers);
}

export function createAccountService(sdk: AccountSdk, storage: KeyValueStorage | null) {
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

  return {
    async load(userId: string): Promise<AccountProfile> {
      const attrs = await sdk.fetchUserAttributes();
      const email = attrs.email ?? '';
      const chosen = attrs.preferred_username?.trim() ?? '';
      const hasUsername = chosen.length > 0;
      return {
        userId,
        email,
        username: hasUsername ? chosen : fallbackUsername(email),
        hasUsername,
        avatar: isSafeAvatar(attrs.picture) ? attrs.picture : null,
        favoriteTape: readFavorite(userId),
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
      if (!storage) throw Object.assign(new Error('Browser storage is unavailable.'), { name: 'StorageUnavailable' });
      if (tape) storage.setItem(FAVORITE_KEY(userId), JSON.stringify(tape));
      else storage.removeItem(FAVORITE_KEY(userId));
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
