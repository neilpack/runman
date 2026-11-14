import { useState } from 'react';
import type { PlaybackDiagnostic } from '@/audio/playbackDiagnostics';
import './PlaybackDiagnostics.css';

export function PlaybackDiagnostics({ diagnostic, onDismiss }: { diagnostic: PlaybackDiagnostic; onDismiss(): void }) {
  const [copyStatus, setCopyStatus] = useState('');
  const text = JSON.stringify(diagnostic, null, 2);
  return <aside className="playback-diagnostics" aria-label="Playback error details" onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
    <p role="alert"><strong>{diagnostic.summary}</strong></p>
    <p>Copy these details to help diagnose playback. They exclude tokens, file names and playback URLs.</p>
    {diagnostic.s3?.outcome === 'checking' && <p role="status">Checking the S3 response…</p>}
    <details open><summary>Error details</summary><pre tabIndex={0}>{text}</pre></details>
    <div>
      <button className="studio-btn" type="button" disabled={diagnostic.s3?.outcome === 'checking'} onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopyStatus('Copied.'), () => setCopyStatus('Select and copy the details above.'));
        if (!navigator.clipboard) setCopyStatus('Select and copy the details above.');
      }}>Copy error details</button>
      <button className="studio-btn" type="button" onClick={onDismiss}>Dismiss</button>
    </div>
    {copyStatus && <p role="status">{copyStatus}</p>}
  </aside>;
}
