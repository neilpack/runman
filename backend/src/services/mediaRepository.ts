import { mediaObjectKey, validateMediaLedger, type MediaLedger } from '@runman/shared';
import type { PendingMedia, ReadyMedia } from './mediaStorage.js';

export class MediaCorrupt extends Error {}
export class MediaConflict extends Error {}
export interface MediaRepository {
  get(owner: string, mediaId: string): Promise<MediaLedger | undefined>;
  create(record: PendingMedia): Promise<void>;
  /** Returns the existing immutable READY winner after a concurrent completion. */
  complete(record: ReadyMedia): Promise<ReadyMedia>;
}
export function checkedMedia(input: unknown, owner?: string, mediaId?: string): MediaLedger {
  const checked = validateMediaLedger(input);
  if (!checked.ok || (owner !== undefined && checked.value.owner !== owner) || (mediaId !== undefined && checked.value.mediaId !== mediaId)) throw new MediaCorrupt();
  return checked.value;
}
export function sameMediaIntent(a: MediaLedger, b: MediaLedger) {
  return ['schemaVersion', 'PK', 'SK', 'owner', 'mediaId', 'objectKey', 'source', 'sizeBytes', 'contentType', 'sha256', 'createdAt', 'expiresAt'].every((key) => a[key as keyof MediaLedger] === b[key as keyof MediaLedger]);
}
/** Injectable offline test repository only; never selected by runtime configuration. */
export function createMemoryMediaRepository(): MediaRepository {
  const records = new Map<string, MediaLedger>();
  const key = (owner: string, id: string) => mediaObjectKey(owner, id);
  return {
    async get(owner, id) { const value = records.get(key(owner, id)); return value ? checkedMedia(value, owner, id) : undefined; },
    async create(input) {
      const value = checkedMedia(input);
      if (value.state !== 'PENDING') throw new MediaCorrupt();
      const id = key(value.owner, value.mediaId);
      if (records.has(id)) throw new MediaConflict();
      records.set(id, value);
    },
    async complete(input) {
      const value = checkedMedia(input);
      if (value.state !== 'READY') throw new MediaCorrupt();
      const id = key(value.owner, value.mediaId); const previous = records.get(id);
      if (!previous || !sameMediaIntent(previous, value)) throw new MediaConflict();
      if (previous.state === 'READY') return checkedMedia(previous) as ReadyMedia;
      records.set(id, value); return checkedMedia(value) as ReadyMedia;
    },
  };
}
