import { useEffect, useId, useRef, useState } from 'react';
import type { StoredAudioReference } from '@runman/shared';
import { audioStorage } from '@/audio/amplifyAudioStorage';
import { validateAudio, type AudioUpload, type AudioProgress } from '@/audio/audioStorage';
import { recordAudio, type AudioRecording } from '@/audio/recordAudio';
import { Button } from './Button';
import './AudioInput.css';

interface AudioInputProps {
  /** Render under a key equal to cassetteId when changing cassette drafts. */
  cassetteId?: string;
  /** Adopt the completed reference into the draft; cassette Save remains separate. */
  onUploaded?: (reference: StoredAudioReference, metadata: UploadedAudioMetadata) => void;
  /** Longest clip that may be added (e.g. tape time left on a side). Longer clips can't be uploaded. */
  maxDurationSec?: number;
  /** What the limit belongs to, for the error message (e.g. "Side A"). */
  limitLabel?: string;
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface UploadedAudioMetadata {
  name: string;
  durationSec: number;
}

interface DraftAudio {
  data: Blob;
  name: string;
  source: StoredAudioReference['source'];
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone access was denied. Allow access in your browser, then try again.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone was found. Connect one or choose an audio file.';
  if (error instanceof DOMException && error.name === 'AbortError') return 'Cancelled. You can try again.';
  return error instanceof Error ? error.message : 'Audio could not be processed. Please try again.';
}

export function AudioInput({ cassetteId, onUploaded, maxDurationSec, limitLabel = 'This tape' }: AudioInputProps) {
  const id = useId();
  const [draft, setDraft] = useState<DraftAudio>();
  const [preview, setPreview] = useState<string>();
  const [status, setStatus] = useState<'idle' | 'requesting' | 'recording' | 'stopping' | 'uploading' | 'removing'>('idle');
  const [error, setError] = useState<string>();
  const [bytes, setBytes] = useState(0);
  const [progress, setProgress] = useState<AudioProgress>();
  const [uploaded, setUploaded] = useState<StoredAudioReference>();
  const [durationSec, setDurationSec] = useState(0);
  const [adopted, setAdopted] = useState(false);
  const [handoffAttempted, setHandoffAttempted] = useState(false);
  const active = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const recording = useRef<AudioRecording | undefined>(undefined);
  const upload = useRef<AudioUpload | undefined>(undefined);
  const player = useRef<HTMLAudioElement | null>(null);
  const busy = status !== 'idle';
  const canUpload = Boolean(cassetteId && onUploaded);
  const tooLong = maxDurationSec !== undefined && durationSec > maxDurationSec;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      upload.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!draft) { setPreview(undefined); setDurationSec(0); return; }
    const url = URL.createObjectURL(draft.data);
    const audio = player.current;
    setPreview(url);
    return () => {
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      URL.revokeObjectURL(url);
    };
  }, [draft]);

  function selectDraft(value: DraftAudio) {
    validateAudio(value.data, (type) => document.createElement('audio').canPlayType(type) !== '');
    setDraft(value);
    setUploaded(undefined);
    setDurationSec(0);
    setAdopted(false);
    setHandoffAttempted(false);
    setError(undefined);
  }

  function discardDraft() {
    if (busy || uploaded) return;
    player.current?.pause();
    setDraft(undefined);
    setPreview(undefined);
    setDurationSec(0);
    setProgress(undefined);
    setBytes(0);
    setError(undefined);
  }

  async function startRecording() {
    if (busy) return;
    setError(undefined);
    player.current?.pause();
    setBytes(0);
    setStatus('requesting');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const session = await recordAudio(abort.signal, (value) => { if (active.current) setBytes(value); });
      recording.current = session;
      if (active.current) setStatus('recording');
      const data = await session.result;
      if (active.current) selectDraft({ data, name: 'Microphone recording', source: 'recording' });
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      recording.current = undefined;
      controller.current = undefined;
      if (active.current) setStatus('idle');
    }
  }

  async function uploadDraft() {
    if (!draft || !cassetteId || !onUploaded || busy || uploaded || tooLong) return;
    setError(undefined);
    setProgress(undefined);
    setStatus('uploading');
    try {
      const task = audioStorage.upload({
        cassetteId, data: draft.data, source: draft.source,
        onProgress: (value) => { if (active.current) setProgress(value); },
      });
      upload.current = task;
      const reference = await task.result;
      if (active.current) setUploaded(reference);
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      upload.current = undefined;
      if (active.current) setStatus('idle');
    }
  }

  async function discardUpload() {
    if (!uploaded || !cassetteId || handoffAttempted || busy) return;
    setStatus('removing');
    setError(undefined);
    try {
      // This reference has never left the control, so no cassette can use it yet.
      await audioStorage.removeUnused(cassetteId, uploaded);
      if (active.current) setUploaded(undefined);
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setStatus('idle');
    }
  }

  return (
    <div className="audio-input">
      <p id={`${id}-help`} className="muted">Choose audio or record a clip. Maximum 25 MB. Your original audio is kept without conversion.</p>
      <label
        className={`audio-file-picker${busy || uploaded ? ' disabled' : ''}`}
        htmlFor={`${id}-file`}
        aria-disabled={busy || Boolean(uploaded)}
      >
        <span className="audio-file-icon" aria-hidden="true">↥</span>
        <span className="audio-file-copy">
          <strong>{draft ? 'Choose a different audio file' : 'Choose an audio file'}</strong>
          <small>{draft ? draft.name : 'MP3, WAV, M4A, OGG, or WebM · up to 25 MB'}</small>
        </span>
      </label>
      <input id={`${id}-file`} className="audio-file-input" type="file" accept="audio/*" disabled={busy || Boolean(uploaded)} aria-describedby={`${id}-help`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            try { selectDraft({ data: file, name: file.name, source: 'upload' }); }
            catch (cause) { setError(errorMessage(cause)); }
          }
          event.currentTarget.value = '';
        }} />
      <div className="audio-actions">
        <Button
          type="button"
          variant="secondary"
          className="audio-record-button"
          disabled={busy || Boolean(uploaded)}
          onClick={() => { void startRecording(); }}
        >
          <svg className="audio-record-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="3" width="8" height="12" rx="4" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
          </svg>
          Record microphone
        </Button>
        {status === 'requesting' && <Button type="button" variant="secondary" onClick={() => controller.current?.abort()}>Cancel microphone request</Button>}
        {status === 'recording' && <>
          <Button type="button" onClick={() => { setStatus('stopping'); recording.current?.stop(); }}>Stop recording</Button>
        </>}
      </div>
      <p role="status" aria-live="polite">
        {status === 'requesting' && 'Waiting for microphone permission…'}
        {status === 'recording' && `Recording: ${(bytes / 1_000_000).toFixed(2)} MB`}
        {status === 'stopping' && 'Finishing recording…'}
        {status === 'uploading' && `Uploading: ${((progress?.transferredBytes ?? 0) / 1_000_000).toFixed(2)} MB`}
        {status === 'removing' && 'Removing unused upload…'}
        {status === 'idle' && uploaded && (adopted ? 'Audio added to this draft. Save the cassette to keep it.' : 'Upload finished. Add this audio to your cassette.')}
      </p>
      {draft && <div className="audio-preview">
        <p>{draft.name} · {(draft.data.size / 1_000_000).toFixed(2)} MB</p>
        <audio
          ref={player}
          controls
          src={preview}
          preload="metadata"
          aria-label={`Preview ${draft.name}`}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            setDurationSec(Number.isFinite(duration) ? duration : 0);
          }}
          onError={() => setError('This audio could not be played. Try a different file or recording format.')}
        />
      </div>}
      {draft && !uploaded && !busy && (
        <div className="audio-actions">
          <Button type="button" variant="secondary" className="audio-discard-button" onClick={discardDraft}>
            Discard audio
          </Button>
        </div>
      )}
      {canUpload && draft && <div className="audio-actions">
        {!uploaded && <Button type="button" disabled={busy || tooLong} onClick={() => { void uploadDraft(); }}>Upload audio</Button>}
        {status === 'uploading' && <Button type="button" variant="secondary" onClick={() => upload.current?.cancel()}>Cancel upload</Button>}
        {uploaded && <Button type="button" disabled={adopted || busy || durationSec <= 0 || tooLong} onClick={() => {
          // A throwing callback might already have changed its parent's draft.
          // Once offered to persistence, this control must never delete the file.
          setHandoffAttempted(true);
          try {
            onUploaded?.(uploaded, { name: draft?.name ?? 'Uploaded audio', durationSec });
            setAdopted(true);
            setError(undefined);
          }
          catch (cause) { setError(errorMessage(cause)); }
        }}>Add to cassette</Button>}
        {uploaded && !handoffAttempted && <Button type="button" variant="secondary" disabled={busy} onClick={() => { void discardUpload(); }}>Discard upload</Button>}
        {adopted && <Button type="button" variant="secondary" onClick={() => {
          setDraft(undefined); setUploaded(undefined); setAdopted(false); setHandoffAttempted(false);
        }}>Choose another clip</Button>}
      </div>}
      {canUpload && draft && tooLong && !adopted && <p className="error" role="alert">
        This clip is {clock(durationSec)}, but {limitLabel} only has {clock(maxDurationSec ?? 0)} left on the tape. Choose a shorter clip.
      </p>}
      {!canUpload && <p className="muted">Preview is available here. Saving audio will be available when cassette saving is connected.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
