import { useState } from 'react';
import { Link } from 'react-router';
import { cassetteStore, useCassettes, useCassetteSync } from '@/hooks/useCassettes';
import './cloud.css';

/** Account actions sit outside the pointer-driven studio canvas. */
export function CassetteCloudPanel({ onCreate }: { onCreate: () => void }) {
  const sync = useCassetteSync();
  const cassettes = useCassettes();
  const [selected, setSelected] = useState<string[]>([]);
  const [imported, setImported] = useState(0);
  if (sync.status === 'hidden') return null;
  return (
    <section className="cassette-cloud-panel" aria-label="Tape storage">
      <div className="cassette-cloud-row">
        <div>
          <strong>{sync.status === 'authenticated' ? 'Your tape library' : 'Try the studio'}</strong>
          <p>{sync.status === 'authenticated'
            ? 'Edits stay as drafts on this device. Use Save to account in the editor to save them online.'
            : 'Guest tapes stay on this device. Sign in to save tapes to your account.'}</p>
        </div>
        {sync.status === 'authenticated' ? (
          <div className="cassette-cloud-actions">
            <button type="button" className="studio-btn" disabled={sync.loading} onClick={() => void cassetteStore.refresh()}>
              {sync.loading ? 'Loading tapes…' : 'Refresh saved tapes'}
            </button>
            {sync.nextCursor && <button type="button" className="studio-btn" disabled={sync.loading} onClick={() => void cassetteStore.loadMore()}>Load more</button>}
          </div>
        ) : <Link to="/login" className="studio-btn primary">Sign in</Link>}
      </div>
      {sync.listError && <p role="alert">{sync.listError} Your local drafts are still available.</p>}
      {sync.storageError && <p role="alert">{sync.storageError}</p>}
      {sync.status === 'authenticated' && !sync.loading && cassettes.length === 0 && (
        <p>No tapes on this device yet. <button type="button" className="studio-btn" onClick={onCreate}>Create a tape</button></p>
      )}
      {sync.status === 'authenticated' && sync.legacy.length > 0 && (
        <details className="cassette-import">
          <summary>Import existing browser tapes ({sync.legacy.length})</summary>
          <p>Choose tapes to copy into this account as drafts. Originals stay untouched. Open each imported tape and Save to account when ready.</p>
          <div className="cassette-import-list">
            {sync.legacy.map((tape) => (
              <label key={tape.id}>
                <input type="checkbox" checked={selected.includes(tape.id)} onChange={(event) => {
                  setSelected((ids) => event.target.checked ? [...ids, tape.id] : ids.filter((id) => id !== tape.id));
                }} />
                {tape.name || 'Untitled Mix'}
              </label>
            ))}
          </div>
          <button type="button" className="studio-btn" disabled={!selected.length} onClick={() => {
            if (cassetteStore.getSync().context !== sync.context) return;
            const copies = cassetteStore.importLegacy(selected);
            setImported(copies.length);
            setSelected([]);
          }}>Import selected as drafts</button>
          {imported > 0 && <p role="status">{imported} tape{imported === 1 ? '' : 's'} copied into this account. Nothing was uploaded.</p>}
        </details>
      )}
    </section>
  );
}
