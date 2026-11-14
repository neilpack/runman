/** Recorded elapsed time is authoritative when WebM reports Infinity/NaN/zero. */
export function draftAudioDuration(source: 'upload' | 'recording', recorded: number | undefined, metadata: number): number {
  const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (source === 'recording' && positive(recorded)) return recorded;
  return positive(metadata) ? metadata : 0;
}

interface DurationAudio {
  duration: number;
  src: string;
  preload: string;
  onloadedmetadata: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  removeAttribute(name: string): void;
  load(): void;
}
export interface DurationDependencies {
  audio(): DurationAudio;
  objectUrl(data: Blob): string;
  revoke(url: string): void;
}
const browser: DurationDependencies = {
  audio: () => document.createElement('audio'), objectUrl: (data) => URL.createObjectURL(data), revoke: (url) => URL.revokeObjectURL(url),
};

/** File-only metadata probe. Recordings use their captured elapsed time instead. */
export function readAudioDuration(data: Blob, signal: AbortSignal, deps: DurationDependencies = browser): Promise<number> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('Duration lookup canceled.', 'AbortError');
    if (signal.aborted) { reject(aborted()); return; }
    const audio = deps.audio(); const url = deps.objectUrl(data); let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function finish(error?: Error) {
      if (settled) return; settled = true;
      const duration = audio.duration;
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      audio.onloadedmetadata = null; audio.onerror = null;
      try { audio.removeAttribute('src'); audio.load(); } catch { /* Metadata lookup is already settled. */ }
      deps.revoke(url);
      if (error) reject(error); else resolve(duration);
    }
    function cancel() { finish(aborted()); }
    const failed = () => finish(new Error('The audio duration could not be determined. Choose a different file.'));
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => Number.isFinite(audio.duration) && audio.duration > 0 ? finish() : failed();
    audio.onerror = failed;
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(failed, 10_000);
    try { audio.src = url; } catch { failed(); }
  });
}
