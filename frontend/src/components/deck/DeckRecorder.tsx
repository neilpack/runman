import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { CASSETTE_LIMITS, type StoredAudioReference } from '@runman/shared';
import { AudioInput, type UploadedAudioMetadata } from '@/components/AudioInput';
import { cassetteStore, newId, useCassette, useCassetteSync } from '@/hooks/useCassettes';
import { createEditorSaver } from '@/cassettes/editorSaver';
import { adoptTapeRecording, recordingTimeLeft, type RecordingTarget } from '@/audio/tapeRecording';
import './recordDialog.css';

export function DeckRecorder({ target, onClose, onRecordingStopped, inline = false }: { target: RecordingTarget; onClose(): void; onRecordingStopped(): void; inline?: boolean }) {
  const cassette = useCassette(target.cassetteId);
  const sync = useCassetteSync();
  const [attached, setAttached] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [recordSide, setRecordSide] = useState(target.side);
  const [recordingReady, setRecordingReady] = useState(false);
  const [sideNotice, setSideNotice] = useState<string>();
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const save = useRef(createEditorSaver(cassetteStore, target.cassetteId, target.context));
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    if (!inline) document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => { active.current = false; if (!inline) document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [inline]);

  const current = () => active.current && cassetteStore.getSync().context === target.context;
  async function saveRecording() {
    if (saving || !current()) return;
    setSaving(true); setError(undefined);
    try {
      const complete = await save.current();
      if (!current()) return;
      setSaved(complete);
      if (!complete) setError(cassetteStore.getSync().tapes[target.cassetteId]?.error ?? 'The recording is in your local draft. Retry saving, or open the editor to resolve the save.');
    } catch {
      if (current()) setError('Your recording remains in the local draft. Retry saving to your account.');
    } finally { if (current()) setSaving(false); }
  }
  function adopt(reference: StoredAudioReference, metadata: UploadedAudioMetadata) {
    if (!current()) throw new Error('Your account changed. Reopen the recorder.');
    adoptTapeRecording(cassetteStore, { ...target, side: recordSide }, reference, metadata, newId);
    setSideNotice(undefined);
    setAttached(true); void saveRecording();
  }
  if (!cassette || sync.context !== target.context || sync.status === 'hidden') return null;
  const otherSide = target.side === 'A' ? 'B' : 'A';
  const sideFull = recordingTimeLeft(cassette, recordSide) <= 0 || cassette.tracks.length >= CASSETTE_LIMITS.tracksPerCassette;
  const otherSideAvailable = recordingTimeLeft(cassette, otherSide) > 0 && cassette.tracks.length < CASSETTE_LIMITS.tracksPerCassette;
  const recordingStopped = () => { onRecordingStopped(); setRecordingReady(true); };
  const panel = <section ref={dialog} className="record-dialog" role="dialog" aria-modal={!inline} aria-labelledby="deck-record-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), audio[controls]');
      const first = items?.[0]; const last = items?.[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="record-dialog-head"><div><p className="eyebrow">Side {recordSide} · {cassette.name}</p><h2 id="deck-record-title">Record a track</h2></div>
      <button ref={close} type="button" className="record-dialog-close" onClick={onClose} aria-label="Close recorder">×</button></header>
    <p className="record-dialog-copy">Record from your microphone, stop and preview, then upload to this tape. Playback is stopped while you record.</p>
    {!attached && (sideFull
      ? <div className="record-capacity-warning">
        <p role="alert">Side {recordSide} is full or the cassette has 100 tracks. Free space before recording.</p>
        {otherSideAvailable && recordSide === target.side && <button type="button" className="studio-btn" onClick={() => { setRecordSide(otherSide); setSideNotice(`Side ${otherSide} selected. Save the recording to add it there.`); }}>Record on Side {otherSide} instead</button>}
        <Link className="studio-btn" to={`/cassettes/${target.cassetteId}/edit`} onClick={onClose}>Open tape editor</Link>
      </div>
      : <AudioInput cassetteId={target.cassetteId} recordingOnly autoRecord maxDurationSec={recordingTimeLeft(cassette, recordSide)} limitLabel={`Side ${recordSide}`} uploadLabel={`Save audio on Side ${recordSide}`} onRecordingStopped={recordingStopped} onUploaded={adopt} />)}
    {recordingReady && !attached && recordSide === target.side && otherSideAvailable && <button type="button" className="studio-btn" onClick={() => { setRecordSide(otherSide); setSideNotice(`Side ${otherSide} selected. Save the recording to add it there.`); setError(undefined); }}>Use Side {otherSide} instead</button>}
    {sideNotice && !attached && <p className="record-side-notice" role="status">{sideNotice}</p>}
    {attached && <p role="status">{saving ? 'Saving your recording to this cassette…' : saved ? 'Recording saved to your account.' : 'Recording kept in your local draft.'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {attached && !saved && !saving && <button type="button" className="studio-btn" onClick={() => void saveRecording()}>Retry saving cassette</button>}
    {attached && <Link className="studio-btn" to={`/cassettes/${target.cassetteId}/edit`} onClick={onClose}>Open tape editor</Link>}
    {saved && <button type="button" className="studio-btn primary" onClick={onClose}>Done</button>}
    <p className="record-dialog-note">Audio stays in private S3 storage. Closing this window does not delete completed uploads.</p>
  </section>;
  if (inline) return <div className="record-dialog-inline">{panel}</div>;
  return createPortal(<div className="record-dialog-backdrop studio-vars" onClick={onClose}>
    {panel}
  </div>, document.body);
}
