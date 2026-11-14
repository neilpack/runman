import type { Cassette, StoredAudioReference, TapeSide, Track, Visibility } from './index.js';

interface PersistedTrackDetails extends Omit<Track, 'source' | 'audioUrl' | 'audioReference' | 'visibility'> {}
export type PersistedCassetteTrack =
  | (PersistedTrackDetails & { source: 'library'; provider: 'jamendo'; sourceId: string; audioUrl?: string })
  /**
   * A public Explore song. Its stable audio URL depends on the API origin, so only `hasAudio`
   * is stored and the client rebuilds the URL from `sourceId` on restore.
   */
  | (PersistedTrackDetails & { source: 'community'; provider: 'explore'; sourceId: string; hasAudio: boolean })
  | (PersistedTrackDetails & { source: 'upload' | 'recording'; provider: 's3'; audio: StoredAudioReference; visibility?: Visibility });

/** Preserve absent sideB fields exactly; never flatten side B's inherited look. */
export interface CassettePayload extends Omit<Cassette, 'tracks' | 'createdAt' | 'updatedAt'> {
  tracks: PersistedCassetteTrack[];
}

/** Public input cannot choose ownership, keys, timestamps, schema, or new revision. */
export interface SaveCassetteRequest { cassette: CassettePayload; expectedRevision: number }
export interface DeleteCassetteRequest { expectedRevision: number }
export interface CassetteDocument {
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  payload: CassettePayload;
}

/** Future server-only item. Derive USER#... from a verified Cognito JWT sub. */
export interface CassetteDynamoItem extends CassetteDocument {
  PK: `USER#${string}`;
  SK: `CASSETTE#${string}`;
}

export interface CassetteResponse { cassette: CassetteDocument }
export interface ListCassettesRequest { limit?: number; cursor?: string }
/** Future Query ordered by stable cassette ID (ascending), never table Scan. */
export interface ListCassettesResponse { items: CassetteDocument[]; nextCursor?: string }
export interface DeleteCassetteResponse { id: string; deletedRevision: number }

/** Legacy callers can supply durable references separately from the UI track. */
export type CassetteAudioReferences = Partial<Record<TapeSide, Record<string, StoredAudioReference>>>;
export interface RestoredCassette { cassette: Cassette; audioReferences: CassetteAudioReferences }
export interface RestoreCassetteOptions {
  /** Stable playback URL for a community (Explore) song, e.g. the API's /api/explore/songs/:id/audio. */
  communityAudioUrl?(songId: string): string;
}

export interface CassetteValidationIssue { path: string; message: string }
export type CassetteValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: CassetteValidationIssue[] };

export const CASSETTE_LIMITS = {
  metadataBytes: 256 * 1024,
  tracksPerCassette: 100,
  stickersPerSide: 100,
  id: 128,
  name: 120,
  title: 256,
  artist: 256,
  stickerKind: 80,
  customStickers: 5,
  customStickerStrokes: 160,
  /** Coordinates (x and y each count) across all strokes of one drawing. */
  customStickerCoords: 4000,
  url: 2048,
  objectKey: 1024,
  audioBytes: 25_000_000,
  durationSec: 86_400,
  cursor: 2048,
  listLimit: 100,
} as const;
