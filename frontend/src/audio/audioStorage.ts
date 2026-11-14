import { parseMediaObjectKey, validateCreateMediaUploadRequest, type CreateMediaUploadRequest, type CreateMediaUploadResponse, type StoredAudioReference } from '@runman/shared';
import { checkedMediaReference, type MediaAccount, type MediaApi } from '../api/mediaClient';

export const MAX_AUDIO_BYTES = 25_000_000;
export const PLAYBACK_URL_SECONDS = 300;
export function canonicalAudioType(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid audio content type.');
  const canonical = value.toLowerCase().trim().replace(/\s*;\s*/g, ';').replace(/\s*=\s*/g, '=').replace(/\s*,\s*/g, ',');
  if (!validateCreateMediaUploadRequest({ source: 'upload', contentType: canonical, sizeBytes: 1, sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }).ok) throw new Error('This audio format is not supported.');
  return canonical;
}
export function validateAudio(data: Blob, canPlayType: (type: string) => boolean): void {
  if (data.size === 0) throw new Error('Audio is empty.');
  if (data.size > MAX_AUDIO_BYTES) throw new Error('Audio must be 25 MB or smaller.');
  if (!canPlayType(canonicalAudioType(data.type))) throw new Error('This audio format cannot be played in this browser.');
}
export interface AudioProgress { transferredBytes: number; totalBytes?: number }
export interface AudioUpload { result: Promise<StoredAudioReference>; cancel(): void; canRetryCompletion(): boolean; retryCompletion(): Promise<StoredAudioReference> }
export interface AudioStorageDependencies {
  api: MediaApi;
  account(): MediaAccount | null;
  subscribeAccount(listener: () => void): () => void;
  canPlayType(type: string): boolean;
  hash(data: Blob): Promise<string>;
  post(grant: CreateMediaUploadResponse['upload'], data: Blob, signal: AbortSignal, onProgress?: (progress: AudioProgress) => void): Promise<void>;
}
function segment(value: string) { if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid cassette ID.'); }
function same(a: MediaAccount | null, b: MediaAccount | null) { return Boolean(a && b && a.owner === b.owner && a.generation === b.generation); }
const canceled = () => new DOMException('Audio operation canceled; uploaded bytes may be retained privately.', 'AbortError');

export function createAudioStorage(deps: AudioStorageDependencies) {
  return {
    upload(input: { cassetteId: string; data: Blob; source: StoredAudioReference['source']; onProgress?: (progress: AudioProgress) => void }): AudioUpload {
      const account = deps.account();
      let controller = new AbortController(); let stopped = false;
      let stage: 'prepare' | 'post' | 'complete' | 'done' | 'failed' = 'prepare';
      let mediaId: string | undefined; let metadata: CreateMediaUploadRequest;
      let completion: Promise<StoredAudioReference> | undefined;
      const accountChanged = () => { if (!same(account, deps.account())) controller.abort(); };
      let unsubscribe = deps.subscribeAccount(accountChanged);
      function guard() { if (stopped || controller.signal.aborted || !same(account, deps.account())) throw canceled(); }
      function complete(): Promise<StoredAudioReference> {
        if (completion) return completion;
        const attempt = (async () => {
          guard();
          if (!account || !mediaId || stage !== 'complete') throw new Error('No completed transfer is available to finalize.');
          let result;
          try { result = await deps.api.complete(account, mediaId, controller.signal); }
          catch (error) {
            if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && error.status > 0 && error.status < 500) { stage = 'failed'; unsubscribe(); }
            throw error;
          }
          guard();
          const reference = checkedMediaReference(result.reference, account, mediaId, metadata);
          stage = 'done'; unsubscribe(); return reference;
        })();
        completion = attempt;
        void attempt.then(() => { completion = undefined; }, () => { completion = undefined; if (!same(account, deps.account())) unsubscribe(); });
        return attempt;
      }
      const result = (async () => {
        segment(input.cassetteId); validateAudio(input.data, deps.canPlayType);
        if (!account) throw new Error('Sign in before uploading private audio.');
        guard();
        const contentType = canonicalAudioType(input.data.type);
        const sha256 = await deps.hash(input.data); guard();
        metadata = { source: input.source, contentType, sizeBytes: input.data.size, sha256 };
        if (!validateCreateMediaUploadRequest(metadata).ok) throw new Error('Invalid audio upload metadata or checksum.');
        const grant = await deps.api.createUpload(account, metadata, controller.signal); guard();
        mediaId = grant.mediaId; stage = 'post';
        await deps.post(grant.upload, input.data, controller.signal, (progress) => { if (!stopped && !controller.signal.aborted && same(account, deps.account())) input.onProgress?.(progress); });
        guard(); stage = 'complete'; return complete();
      })();
      void result.catch(() => { if (stage !== 'complete' || !same(account, deps.account())) unsubscribe(); });
      return {
        result,
        cancel() { stopped = true; controller.abort(); unsubscribe(); },
        canRetryCompletion: () => stage === 'complete' && !completion && same(account, deps.account()),
        retryCompletion() {
          if (stage !== 'complete' || !same(account, deps.account())) return Promise.reject(canceled());
          if (!completion) { stopped = false; controller = new AbortController(); unsubscribe(); unsubscribe = deps.subscribeAccount(accountChanged); }
          return complete();
        },
      };
    },
    async playback(cassetteId: string, reference: StoredAudioReference, signal?: AbortSignal) {
      segment(cassetteId);
      const account = deps.account(); const parsed = parseMediaObjectKey(reference.objectKey);
      if (!account || !parsed || parsed.owner !== account.owner) throw new Error('Private audio does not belong to this account.');
      checkedMediaReference(reference, account, parsed.mediaId);
      const controller = new AbortController(); const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const unsubscribe = deps.subscribeAccount(() => { if (!same(account, deps.account())) controller.abort(); });
      try {
        if (signal?.aborted || controller.signal.aborted) throw canceled();
        const result = await deps.api.playback(account, parsed.mediaId, controller.signal);
        if (controller.signal.aborted || !same(account, deps.account())) throw canceled();
        return { url: new URL(result.url), expiresAt: new Date(result.expiresAt) };
      } finally { unsubscribe(); signal?.removeEventListener('abort', abort); }
    },
  };
}
