import type { StoredAudioReference } from './index.js';
import type { CassetteValidationResult } from './cassettePersistence.js';

export const MEDIA_LIMITS = { audioBytes: 25_000_000, intentSeconds: 300, requestBytes: 4 * 1024, ledgerBytes: 16 * 1024, owner: 128, versionId: 1024 } as const;
export type MediaSource = StoredAudioReference['source'];
/** POST /api/media/uploads. MIME/checksum are exact canonical strings, not normalized. */
export interface CreateMediaUploadRequest { source: MediaSource; contentType: string; sizeBytes: number; sha256: string }
/** POST /api/media/complete and /api/media/playback respectively. No caller keys/owners. */
export interface CompleteMediaUploadRequest { mediaId: string }
export interface MediaPlaybackRequest { mediaId: string }

/** Transient bearer grant: memory only, never part of a durable reference/ledger. */
export interface CreateMediaUploadResponse {
  mediaId: string;
  upload: { url: string; fields: Record<string, string>; expiresAt: string };
}
export interface CompleteMediaUploadResponse { reference: StoredAudioReference }
/** Transient version-pinned playback grant, never cassette metadata. */
export interface MediaPlaybackResponse { url: string; expiresAt: string }

interface MediaLedgerBase extends CreateMediaUploadRequest {
  schemaVersion: 1;
  PK: `USER#${string}`;
  SK: `MEDIA#${string}`;
  /** Must come from verified Cognito claims in the future backend, never request JSON. */
  owner: string;
  mediaId: string;
  objectKey: string;
  createdAt: string;
  /** Upload-intent expiry only. READY records do not expire; no TTL/GC is implied. */
  expiresAt: string;
}
export type MediaLedger =
  | (MediaLedgerBase & { state: 'PENDING' })
  | (MediaLedgerBase & { state: 'READY'; versionId: string; completedAt: string });
/** Structural validation cannot prove JWT identity, object existence or S3 metadata. */
export type MediaValidationResult<T> = CassetteValidationResult<T>;
