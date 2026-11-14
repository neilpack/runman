/** The media-element boundary, injectable without a browser or private URLs. */
export interface PlaybackElement {
  src: string;
  currentTime: number;
  readonly readyState: number;
  readonly error: { code: number } | null;
  pause(): void;
  load(): void;
  play(): Promise<void>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export class MediaPlaybackError extends Error {
  constructor(public readonly code: number) { super('The audio source could not be played.'); }
}

/** Reload failed/cleared sources, seek when metadata exists, and release listeners on cancellation. */
export function playAudioSource(audio: PlaybackElement, url: string, position: number, signal: AbortSignal, forceReload = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let playing = false;
    let positioned = false;
    function finish(error?: unknown) {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      audio.removeEventListener('loadedmetadata', metadata);
      audio.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    }
    function abort() { finish(new DOMException('Playback canceled.', 'AbortError')); }
    function failed() { finish(new MediaPlaybackError(audio.error?.code ?? 4)); }
    function done() { if (playing && positioned) finish(); }
    function metadata() {
      if (settled || signal.aborted || audio.readyState < 1) return;
      try { audio.currentTime = Math.max(0, position); positioned = true; done(); }
      catch (error) { finish(error); }
    }
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    audio.addEventListener('loadedmetadata', metadata);
    audio.addEventListener('error', failed);
    try {
      // A same-track cache hit does not prove the reusable HTMLAudioElement still
      // has a healthy source (ejection/load failures can clear or poison it).
      if (forceReload || audio.src !== url || audio.error || audio.readyState === 0) {
        audio.pause();
        audio.src = url;
        audio.load();
      }
      metadata();
      if (settled) return;
      // Start loading/playback immediately; apply a pending seek at metadata,
      // rather than assuming a newly assigned source is already seekable.
      void audio.play().then(() => { if (!settled) { playing = true; done(); } }, finish);
    } catch (error) { finish(error); }
  });
}

/** Safe, actionable LCD text. Never show raw SDK/browser errors containing bearer URLs. */
export function playbackFailureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'PRESS PLAY TO ALLOW AUDIO';
  if (error instanceof MediaPlaybackError) {
    if (error.code === 2) return 'AUDIO NETWORK ERROR';
    if (error.code === 3) return 'AUDIO DECODE ERROR';
    return 'AUDIO SOURCE UNAVAILABLE';
  }
  if (error && typeof error === 'object' && 'status' in error) {
    if (error.status === 401) return 'SIGN IN TO PLAY AUDIO';
    if (error.status === 403) return 'AUDIO ACCESS DENIED';
    if (error.status === 404 || error.status === 422) return 'AUDIO FILE UNAVAILABLE';
    if (error.status === 0 || error.status === 503) return 'AUDIO SERVICE UNAVAILABLE';
  }
  if (error instanceof DOMException && error.name === 'NotSupportedError') return 'AUDIO SOURCE UNAVAILABLE';
  return "CAN'T PLAY AUDIO";
}
