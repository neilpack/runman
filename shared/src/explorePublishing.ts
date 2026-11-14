import type { ExploreCatalog, PublicProfile, PublicSong, StoredAudioReference, TapeSnapshot } from './index.js';
import type { CassettePayload, PersistedCassetteTrack } from './cassettePersistence.js';

// ---------------------------------------------------------------------------
// Publishing to Explore (authenticated, /api/explore/mine/...)
//
// Catalog rows live in the cassettes table under fixed partitions, read with Query, never Scan:
//   PK EXPLORE#PROFILE   SK <sub>              PublicProfile (+ updatedAt)
//   PK EXPLORE#USERNAME  SK <lowercase name>   ownerId: claims a username so it stays unique
//   PK EXPLORE#SONG      SK <songId>           a public song + its private audio reference
//   PK EXPLORE#TAPE      SK <tapeId>           PublicTape
//   PK EXPLORE#ADD#<songId> SK <sub>          one row per listener who added the song (dedupes addCount)
// songId / tapeId are derived on the server from (owner, audio object key) / (owner, cassette id),
// so republishing is idempotent and clients never pick catalog keys.
// ---------------------------------------------------------------------------

/** PUT /api/explore/mine/profile. Required before publishing songs or tapes. */
export interface PublishProfileRequest {
  username: string;
  /** Small base64 data URL or https URL; null for the initials fallback. */
  avatar: string | null;
  favoriteTape: TapeSnapshot | null;
  /** Only update an already-published profile (account edits); never create one. */
  ifPublished?: boolean;
}
/** `profile` is null when `ifPublished` was set and nothing was published yet. */
export interface PublishProfileResponse { profile: PublicProfile | null }

/** PUT /api/explore/mine/songs. The audio must be the caller's own READY upload/recording. */
export interface PublishSongRequest {
  title: string;
  artist: string;
  durationSec: number;
  audio: StoredAudioReference;
  artworkUrl?: string;
}
export interface PublishSongResponse { song: PublicSong }
/** DELETE /api/explore/mine/songs. The private upload itself is never deleted. */
export interface UnpublishSongRequest { objectKey: string }
export interface UnpublishResponse { id: string }

/**
 * Tracks on a public tape. Library songs stay Jamendo references; the owner's public uploads
 * become `community` tracks pointing at their PublicSong. Private audio is never included.
 */
export type PublicTapeTrack = Extract<PersistedCassetteTrack, { provider: 'jamendo' | 'explore' }>;
export interface PublicTapePayload extends Omit<CassettePayload, 'tracks' | 'visibility'> { tracks: PublicTapeTrack[] }

/** PUT /api/explore/mine/tapes/:cassetteId with the cassette as saved. DELETE takes no body. */
export interface PublishTapeRequest { cassette: CassettePayload }

export interface PublicTape {
  /** Catalog ID (not the owner's private cassette ID). */
  id: string;
  owner: { userId: string; username: string };
  tape: PublicTapePayload;
  publishedAt: string;
  updatedAt: string;
}
export interface PublishTapeResponse { tape: PublicTape }

/** GET /api/explore/tapes?q=&limit=&offset= */
export interface PublicTapePage { tapes: PublicTape[]; total: number; offset: number; limit: number; catalog: ExploreCatalog }
/** GET /api/explore/tapes/:id */
export interface PublicTapeResponse { tape: PublicTape; catalog: ExploreCatalog }

/** POST /api/explore/songs/:id/adds (signed in). Counts once per listener; feeds trending. */
export interface RecordSongAddResponse { addCount: number }
