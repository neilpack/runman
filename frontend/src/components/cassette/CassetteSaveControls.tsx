import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cassetteStore, useCassette, useCassetteSync } from '@/hooks/useCassettes';
import './cloud.css';

export function CassetteSaveControls({ id }: { id: string }) {
  const sync = useCassetteSync();
  const cassette = useCassette(id);
  const tape = sync.tapes[id];
  const navigate = useNavigate();
  const [confirmReload, setConfirmReload] = useState(false);
  const busy = Boolean(tape?.saving || tape?.deleting || tape?.reloading);
  const authenticated = sync.status === 'authenticated';
  const currentContext = () => cassetteStore.getSync().context === sync.context;
  const status = !authenticated ? 'Guest draft · kept on this device'
    : tape?.saving ? 'Saving to your account…'
    : tape?.deleting ? 'Deleting tape…'
    : tape?.reloading ? 'Loading saved tape…'
    : tape?.conflict ? 'Conflict · your draft was kept'
    : tape?.cloudMissing ? 'Saved tape no longer exists · your draft was kept'
    : tape?.dirty !== false || !tape?.revision ? 'Unsaved changes · local draft'
    : 'Saved to account';
  if (!tape?.error && !tape?.conflict && !tape?.cloudMissing && !sync.storageError) return null;
  return (
    <section className="cassette-save-notice" aria-label="Save tape">
      <div className="cassette-save-actions">
        <span role="status" aria-live="polite">{status}</span>
        <div className="cassette-cloud-actions">
          {authenticated ? (
            <button type="button" className="studio-btn primary" disabled={busy || Boolean(tape?.conflict || tape?.cloudMissing) || tape?.dirty === false} onClick={() => { if (currentContext()) void cassetteStore.save(id); }}>
              {tape?.saving ? 'Saving…' : 'Retry save'}
            </button>
          ) : <Link to="/login" className="studio-btn primary">Sign in to save online</Link>}
          {authenticated && (Boolean(tape?.revision) || tape?.conflict || tape?.cloudMissing) && (
            <button type="button" className="studio-btn" disabled={busy} onClick={() => {
              if (!currentContext()) return;
              if (tape?.dirty || tape?.conflict) setConfirmReload(true);
              else void cassetteStore.reload(id);
            }}>Load saved version</button>
          )}
          {authenticated && (tape?.conflict || tape?.cloudMissing || tape?.error) && (
            <button type="button" className="studio-btn" disabled={busy} onClick={() => {
              if (!currentContext()) return;
              const copy = cassetteStore.copy(id);
              if (copy) navigate(`/cassettes/${copy.id}/edit`);
            }}>Keep draft as a new tape</button>
          )}
        </div>
      </div>
      {tape?.error && <p role="alert" className="cassette-save-error">{tape.error}</p>}
      {cassette?.tracks.some((track) => track.source === 'upload' || track.source === 'recording') && <p>Uploaded and recorded tracks stay in this device’s draft until private audio saving is connected. Your complete tape is kept.</p>}
      {cassette?.tracks.some((track) => track.source === 'community') && <p>Community-song cloud saving is not connected yet. Your complete tape stays in this device’s draft.</p>}
      {tape?.issues && tape.issues.length > 0 && <ul className="cassette-save-error">{tape.issues.slice(0, 8).map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul>}
      {sync.storageError && <p role="alert">{sync.storageError}</p>}
      <ConfirmDialog open={confirmReload} title="Replace this draft with the saved tape?"
        message="This replaces your unsaved edits with the version in your account. Cancel to keep editing, or keep this draft as a new tape first."
        confirmLabel="Replace with saved tape" cancelLabel="Keep editing"
        onCancel={() => setConfirmReload(false)} onConfirm={() => { if (currentContext()) { setConfirmReload(false); void cassetteStore.reload(id, true); } }} />
    </section>
  );
}
