import { randomUUID } from 'node:crypto';
import { MEDIA_LIMITS, mediaObjectKey, parseMediaObjectKey, validateCompleteMediaUploadRequest, validateCreateMediaUploadRequest, validateMediaPlaybackRequest, type MediaValidationResult, type StoredAudioReference } from '@runman/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { checkedMedia, MediaConflict, MediaCorrupt, sameMediaIntent, type MediaRepository } from './mediaRepository.js';
import type { MediaObjectMetadata, PendingMedia, PrivateMediaStorage, ReadyMedia } from './mediaStorage.js';

export type MediaAuthorizer = (owner: string, reference: StoredAudioReference) => Promise<void>;
export function createMediaService(repository: MediaRepository, storage: PrivateMediaStorage, clock = () => new Date().toISOString(), newId: () => string = randomUUID) {
  function valid<T>(result: MediaValidationResult<T>): T {
    if (!result.ok) throw new HttpError(400, 'Invalid media request.', result.issues);
    return result.value;
  }
  const reference = (record: ReadyMedia): StoredAudioReference => ({ source: record.source, objectKey: record.objectKey, contentType: record.contentType, sizeBytes: record.sizeBytes });
  async function operation<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof MediaCorrupt) throw new HttpError(500, 'Invalid media storage record.');
      if (error instanceof MediaConflict) throw new HttpError(409, 'Media upload state changed. Retry completion.');
      throw new HttpError(503, 'Private audio storage is temporarily unavailable.');
    }
  }
  async function owned(owner: string, mediaId: string) {
    const value = await repository.get(owner, mediaId);
    if (!value) throw new HttpError(404, 'Media not found.');
    return checkedMedia(value, owner, mediaId);
  }
  function matches(record: PendingMedia | ReadyMedia, metadata: MediaObjectMetadata | undefined): asserts metadata is MediaObjectMetadata & { versionId: string } {
    if (!metadata || typeof metadata.versionId !== 'string' || !metadata.versionId || metadata.versionId === 'null' || metadata.sizeBytes !== record.sizeBytes || metadata.contentType !== record.contentType || metadata.sha256 !== record.sha256) throw new HttpError(422, 'Uploaded audio does not match the authorized size, MIME, checksum or version.');
    // Reuse structural version bounds before passing any S3 selector onward.
    try { checkedMedia({ ...record, state: 'READY', versionId: metadata.versionId, completedAt: record.state === 'READY' ? record.completedAt : record.createdAt }); }
    catch { throw new HttpError(422, 'Uploaded audio has an invalid pinned version.'); }
  }
  async function pinned(record: ReadyMedia) {
    const metadata = await storage.head(record.objectKey, record.versionId);
    matches(record, metadata);
    if (metadata.versionId !== record.versionId) throw new HttpError(422, 'Pinned audio version is unavailable.');
  }
  return {
    async create(owner: string, body: unknown) {
      const request = valid(validateCreateMediaUploadRequest(body));
      return operation(async () => {
        if (!await storage.versioningEnabled()) throw new HttpError(503, 'Private audio bucket versioning must be enabled.');
        const createdAt = clock(); const mediaId = newId();
        const record = checkedMedia({ ...request, schemaVersion: 1, state: 'PENDING', owner, mediaId, PK: `USER#${owner}`, SK: `MEDIA#${mediaId}`, objectKey: mediaObjectKey(owner, mediaId), createdAt, expiresAt: new Date(Date.parse(createdAt) + MEDIA_LIMITS.intentSeconds * 1000).toISOString() });
        if (record.state !== 'PENDING') throw new MediaCorrupt();
        await repository.create(record);
        const upload = await storage.createUpload(record);
        const expires = Date.parse(upload.expiresAt);
        if (!Number.isFinite(expires) || expires <= Date.parse(clock()) || expires > Date.parse(record.expiresAt)) throw new HttpError(503, 'Upload grant expiry is outside its intent.');
        return { mediaId, upload };
      });
    },
    async complete(owner: string, body: unknown) {
      const { mediaId } = valid(validateCompleteMediaUploadRequest(body));
      return operation(async () => {
        const record = await owned(owner, mediaId);
        if (record.state === 'READY') { await pinned(record); return { reference: reference(record) }; }
        if (Date.parse(clock()) > Date.parse(record.expiresAt)) throw new HttpError(410, 'Upload intent expired. Start a new upload.');
        if (!await storage.versioningEnabled()) throw new HttpError(503, 'Private audio bucket versioning must be enabled.');
        const latest = await storage.head(record.objectKey);
        matches(record, latest);
        const specific = await storage.head(record.objectKey, latest.versionId);
        matches(record, specific);
        if (specific.versionId !== latest.versionId) throw new HttpError(422, 'Uploaded audio version changed during verification.');
        const completedAt = clock();
        if (Date.parse(completedAt) > Date.parse(record.expiresAt)) throw new HttpError(410, 'Upload intent expired during verification. Start a new upload.');
        const candidate = checkedMedia({ ...record, state: 'READY', versionId: specific.versionId, completedAt });
        if (candidate.state !== 'READY') throw new MediaCorrupt();
        const winner = checkedMedia(await repository.complete(candidate), owner, mediaId);
        if (winner.state !== 'READY' || !sameMediaIntent(winner, candidate)) throw new MediaCorrupt();
        await pinned(winner);
        return { reference: reference(winner) };
      });
    },
    async playback(owner: string, body: unknown) {
      const { mediaId } = valid(validateMediaPlaybackRequest(body));
      return operation(async () => {
        const record = await owned(owner, mediaId);
        if (record.state !== 'READY') throw new HttpError(422, 'Audio upload is not complete.');
        await pinned(record);
        return storage.playback(record);
      });
    },
    async authorize(owner: string, input: StoredAudioReference) {
      const selector = parseMediaObjectKey(input.objectKey);
      if (!selector || selector.owner !== owner) throw new HttpError(422, 'Private audio does not belong to this account.');
      return operation(async () => {
        const stored = await repository.get(owner, selector.mediaId);
        if (!stored) throw new HttpError(422, 'Private audio reference has no owned media record.');
        const record = checkedMedia(stored, owner, selector.mediaId);
        if (record.state !== 'READY' || record.objectKey !== input.objectKey || record.source !== input.source || record.contentType !== input.contentType || record.sizeBytes !== input.sizeBytes) throw new HttpError(422, 'Private audio reference does not match owned READY media.');
        await pinned(record);
      });
    },
  };
}
