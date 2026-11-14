import type { TapeSnapshot } from './index.js';

/**
 * Account settings kept in the cassettes table next to the user's tapes
 * (PK `USER#<sub>`, SK `PROFILE`). Username and avatar stay in Cognito attributes.
 */
export interface ProfileDocument {
  schemaVersion: 1;
  /** Server timestamp of the last save. */
  updatedAt: string;
  favoriteTape: TapeSnapshot | null;
}

/** PUT /api/profile. Last write wins; the owner comes from the verified access token. */
export interface SaveProfileRequest { favoriteTape: TapeSnapshot | null }
/** GET /api/profile and PUT /api/profile. `profile` is null before the first save. */
export interface ProfileResponse { profile: ProfileDocument | null }

/** Server-only item shape. */
export interface ProfileDynamoItem extends ProfileDocument {
  PK: `USER#${string}`;
  SK: 'PROFILE';
}
