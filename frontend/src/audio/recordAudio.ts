import { MAX_AUDIO_BYTES } from './audioStorage';

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export interface RecorderHandle {
  mimeType: string;
  state: string;
  start(timeslice: number): void;
  stop(): void;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface RecordingDependencies {
  getMicrophone(): Promise<{ release(): void; recorder(type: string): RecorderHandle }>;
  supports(type: string): boolean;
  now?(): number;
}

export interface AudioRecording {
  result: Promise<Blob>;
  /** Elapsed duration captured while MediaRecorder was running. */
  readonly durationSec: number;
  stop(): void;
  cancel(): void;
}

export const browserRecording: RecordingDependencies = {
  supports: (type) => typeof MediaRecorder !== 'undefined'
    && MediaRecorder.isTypeSupported(type)
    && document.createElement('audio').canPlayType(type) !== '',
  async getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Recording requires microphone support and a secure connection.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return {
      release: () => stream.getTracks().forEach((track) => track.stop()),
      recorder: (type) => new MediaRecorder(stream, { mimeType: type }),
    };
  },
};

/** The signal also handles unmount while the browser permission prompt is open. */
export async function recordAudio(
  signal: AbortSignal,
  onBytes: (bytes: number) => void = () => {},
  deps: RecordingDependencies = browserRecording,
): Promise<AudioRecording> {
  const abortError = () => new DOMException('Recording cancelled.', 'AbortError');
  if (signal.aborted) throw abortError();
  const type = RECORDING_TYPES.find((candidate) => deps.supports(candidate));
  if (!type) throw new Error('This browser cannot record a supported audio format.');
  // A permission prompt cannot be dismissed programmatically. Stop waiting on
  // cancellation and release any stream the browser grants after that point.
  const request = deps.getMicrophone();
  const microphone = await new Promise<Awaited<ReturnType<RecordingDependencies['getMicrophone']>>>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    request.then((value) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { value.release(); reject(abortError()); }
      else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
  if (signal.aborted) {
    microphone.release();
    throw abortError();
  }
  let recorder: RecorderHandle;
  try {
    recorder = microphone.recorder(type);
  } catch (error) {
    microphone.release();
    throw error;
  }
  let chunks: Blob[] = [];
  let bytes = 0;
  let settled = false;
  let stopping = false;
  let startedAt = 0;
  let stoppedAt: number | undefined;
  const now = deps.now ?? (() => performance.now());
  let durationSec = 0;
  let resolve!: (value: Blob) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<Blob>((done, fail) => { resolve = done; reject = fail; });
  function cleanup() {
    signal.removeEventListener('abort', cancel);
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    microphone.release();
    chunks = [];
  }
  function fail(error: Error) {
    if (settled) return;
    settled = true;
    // Detach callbacks before stopping; final chunks from cancellation are discarded.
    const wasActive = recorder.state !== 'inactive';
    cleanup();
    if (wasActive) {
      try { recorder.stop(); } catch { /* Tracks are already released. */ }
    }
    reject(error);
  }
  function cancel() { fail(abortError()); }
  function stop() {
    if (settled || stopping || recorder.state === 'inactive') return;
    stopping = true;
    stoppedAt = now();
    try { recorder.stop(); } catch { fail(new Error('Recording could not be stopped. Please try again.')); }
  }
  recorder.ondataavailable = ({ data }) => {
    if (settled || !data.size) return;
    bytes += data.size;
    if (bytes > MAX_AUDIO_BYTES) {
      fail(new Error('Recording exceeded 25 MB. Please record a shorter clip.'));
      return;
    }
    chunks.push(data);
    onBytes(bytes);
  };
  recorder.onerror = () => fail(new Error('Microphone recording failed. Please try again.'));
  recorder.onstop = () => {
    if (settled) return;
    if (!bytes) { fail(new Error('The recording is empty. Please try again.')); return; }
    const data = new Blob(chunks, { type: recorder.mimeType || type });
    // MediaRecorder WebM blobs often have no usable duration metadata. The
    // elapsed recorder time is reliable for tape capacity and persistence.
    durationSec = Math.max(0.1, ((stoppedAt ?? now()) - startedAt) / 1000);
    settled = true;
    cleanup();
    resolve(data);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try { startedAt = now(); recorder.start(1000); } catch { fail(new Error('Recording could not start. Check microphone access and try again.')); }
  return { result, get durationSec() { return durationSec; }, stop, cancel };
}
