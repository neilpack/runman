import type { CreateMediaUploadResponse, MediaLedger, MediaPlaybackResponse } from '@runman/shared';

export type PendingMedia = Extract<MediaLedger, { state: 'PENDING' }>;
export type ReadyMedia = Extract<MediaLedger, { state: 'READY' }>;
export interface MediaObjectMetadata {
  versionId?: string;
  sizeBytes?: number;
  contentType?: string;
  sha256?: string;
}
/** Private bucket only; callers must authorize media before calling this port. */
export interface PrivateMediaStorage {
  versioningEnabled(): Promise<boolean>;
  createUpload(record: PendingMedia): Promise<CreateMediaUploadResponse['upload']>;
  head(objectKey: string, versionId?: string): Promise<MediaObjectMetadata | undefined>;
  playback(record: ReadyMedia): Promise<MediaPlaybackResponse>;
}
