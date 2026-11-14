import type { AudioProgress } from './audioStorage';
import type { CreateMediaUploadResponse } from '@runman/shared';

/** S3 fields only; file last, no app token or manually set multipart headers. */
export function postAudio(grant: CreateMediaUploadResponse['upload'], data: Blob, signal: AbortSignal, onProgress?: (progress: AudioProgress) => void, makeXhr = () => new XMLHttpRequest()): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = makeXhr(); let settled = false;
    function finish(error?: Error) {
      if (settled) return; settled = true; signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    }
    function abort() { xhr.abort(); finish(new DOMException('Audio transfer canceled; private bytes may be retained.', 'AbortError')); }
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    try {
    xhr.open('POST', grant.url); xhr.withCredentials = false; xhr.timeout = 120_000;
    xhr.upload.onprogress = (event) => { if (!signal.aborted && !settled) onProgress?.({ transferredBytes: event.loaded, ...(event.lengthComputable ? { totalBytes: event.total } : {}) }); };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error('Private audio transfer failed. Your original clip was kept.'));
    xhr.onerror = () => finish(new Error('Private audio transfer could not be confirmed. Your original clip was kept.'));
    xhr.ontimeout = () => finish(new Error('Private audio transfer timed out. Your original clip was kept.'));
    xhr.onabort = () => finish(new DOMException('Audio transfer canceled; private bytes may be retained.', 'AbortError'));
    const form = new FormData();
    for (const [key, value] of Object.entries(grant.fields)) form.append(key, value);
    form.append('file', data, 'audio'); xhr.send(form);
    } catch { finish(new Error('Private audio transfer could not start. Your original clip was kept.')); }
  });
}
export async function audioSha256(data: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer()));
  return btoa(String.fromCharCode(...bytes));
}
