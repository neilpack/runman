import type { StoredAudioReference } from '@runman/shared';

// Decimal MB, as displayed to users. This is a browser guard, not an S3 quota.
export const MAX_AUDIO_BYTES = 25_000_000;
export const PLAYBACK_URL_SECONDS = 300;
const AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a',
  'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac',
]);

export function validateAudio(data: Blob, canPlayType: (type: string) => boolean): void {
  if (data.size === 0) throw new Error('Audio is empty.');
  if (data.size > MAX_AUDIO_BYTES) throw new Error('Audio must be 25 MB or smaller.');
  const baseType = data.type.split(';')[0].trim().toLowerCase();
  if (!AUDIO_TYPES.has(baseType) || !canPlayType(data.type)) {
    throw new Error('This audio format cannot be played in this browser.');
  }
}

export interface AudioProgress {
  transferredBytes: number;
  totalBytes?: number;
}

export interface AudioUpload {
  result: Promise<StoredAudioReference>;
  cancel(): void;
}

/** Small SDK boundary keeps browser behavior testable without AWS credentials. */
export interface AudioStorageDependencies {
  identityId(): Promise<string>;
  randomId(): string;
  canPlayType(contentType: string): boolean;
  upload(input: {
    path: string;
    data: Blob;
    contentType: string;
    onProgress?: (progress: AudioProgress) => void;
  }): { result: Promise<unknown>; cancel(): void };
  playback(path: string): Promise<{ url: URL; expiresAt: Date }>;
  remove(path: string): Promise<unknown>;
}

function segment(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid cassette or audio ID.');
  return value;
}

function prefix(identityId: string, cassetteId: string): string {
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d:[a-f0-9-]{36}$/.test(identityId)) {
    throw new Error('A signed-in Cognito identity is required for audio storage.');
  }
  return `audio/${identityId}/${segment(cassetteId)}/`;
}

function ownedKey(identityId: string, cassetteId: string, reference: StoredAudioReference): string {
  const base = prefix(identityId, cassetteId);
  if (!reference.objectKey.startsWith(base)) throw new Error('Audio does not belong to this identity and cassette.');
  segment(reference.objectKey.slice(base.length));
  return reference.objectKey;
}

export function createAudioStorage(deps: AudioStorageDependencies) {
  return {
    /** Retains the original blob; no conversion or automatic deletion on failure. */
    upload(input: {
      cassetteId: string;
      data: Blob;
      source: StoredAudioReference['source'];
      onProgress?: (progress: AudioProgress) => void;
    }): AudioUpload {
      let cancelled = false;
      let task: ReturnType<AudioStorageDependencies['upload']> | undefined;
      const result = (async (): Promise<StoredAudioReference> => {
        segment(input.cassetteId);
        if (input.source !== 'upload' && input.source !== 'recording') throw new Error('Invalid audio source.');
        validateAudio(input.data, deps.canPlayType);
        const contentType = input.data.type;
        const identityId = await deps.identityId();
        if (cancelled) throw new DOMException('Audio upload cancelled.', 'AbortError');
        const objectKey = `${prefix(identityId, input.cassetteId)}${segment(deps.randomId())}`;
        task = deps.upload({ path: objectKey, data: input.data, contentType, onProgress: input.onProgress });
        await task.result;
        // If completion wins a cancellation race, return the reference so the
        // caller can retain it or explicitly clean it up instead of orphaning it.
        return { source: input.source, objectKey, contentType, sizeBytes: input.data.size };
      })();
      return { result, cancel() { cancelled = true; task?.cancel(); } };
    },

    async playback(cassetteId: string, reference: StoredAudioReference) {
      const identityId = await deps.identityId();
      return deps.playback(ownedKey(identityId, cassetteId, reference));
    },

    /** Call only after a successful save/delete proves this object is unreferenced. */
    async removeUnused(cassetteId: string, reference: StoredAudioReference): Promise<void> {
      const identityId = await deps.identityId();
      await deps.remove(ownedKey(identityId, cassetteId, reference));
    },
  };
}
