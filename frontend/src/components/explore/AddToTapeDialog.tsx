import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { PublicSong, TapeSide } from '@runman/shared';
import { CassetteFace } from '@/components/cassette/CassetteFace';
import { faceFor } from '@/components/cassette/sides';
import { formatTime } from '@/components/cassette/TrackList';
import { cassetteStore, newId, useCassettes, useCassetteSync } from '@/hooks/useCassettes';
import { api } from '@/api/client';
import { tapeFit } from './addToTape';
import { createTapeAdder, type SongAddedToTape } from './tapeAdder';
import './explore.css';

export function AddToTapeDialog({ song, onClose }: { song: PublicSong; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cassettes = useCassettes(); const sync = useCassetteSync(); const context = useRef(sync.context);
  const adder = useRef(createTapeAdder(cassetteStore, { newId, audioUrl: api.publicSongAudioUrl })); const active = useRef(false);
  const [side, setSide] = useState<TapeSide>('A'); const [name, setName] = useState('New Mix');
  const [added, setAdded] = useState<SongAddedToTape>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  useEffect(() => {
    active.current = true; if (ref.current && !ref.current.open) ref.current.showModal();
    if (cassetteStore.getSync().status === 'authenticated') void cassetteStore.refresh();
    return () => { active.current = false; };
  }, []);
  useEffect(() => { if (sync.context !== context.current || sync.status === 'hidden') onClose(); }, [sync.context, sync.status, onClose]);
  const current = () => active.current && cassetteStore.getSync().context === context.current;
  async function add(id?: string) {
    if (busy) return; setBusy(true); setError(undefined);
    try {
      const result = await adder.current.add(song, side, id, name);
      if (!current()) return; setAdded(result);
      if (result.saved && song.provider !== 'jamendo') void api.publish.recordAdd(song.id).catch(() => {});
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The song could not be added.'); }
    finally { if (current()) setBusy(false); }
  }
  async function retry() {
    if (!added || busy) return; setBusy(true); setError(undefined);
    try { const result = await adder.current.save(added.cassetteId, added.side); if (current()) setAdded(result); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Save failed. Your draft was kept.'); }
    finally { if (current()) setBusy(false); }
  }
  if (sync.context !== context.current || sync.status === 'hidden') return null;
  return <dialog ref={ref} className="ex-dialog" aria-labelledby="ex-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) ref.current?.close(); }}>
    <div className="ex-dialog-body">
      <header className="ex-dialog-head"><div><h2 id="ex-dialog-title">{added ? 'Added to your tape' : 'Add to a tape'}</h2><p className="muted"><strong>{song.title}</strong> · {song.artist} · {formatTime(song.durationSec)}</p></div>
        <button type="button" className="ex-icon-btn" onClick={() => ref.current?.close()} aria-label="Close">×</button></header>
      {error && <p role="alert" className="error">{error}</p>}{busy && <p role="status">Saving your tape…</p>}
      {added ? <div className="ex-dialog-done">
        <p role="status">{added.saved ? 'Saved to your account:' : 'Kept in your local draft:'} <strong>{added.name}</strong>, side {added.side}.</p>
        {added.local && <p className="muted">Sign in to keep tapes in your account.</p>}{added.error && <p role="alert" className="error">{added.error}</p>}
        <div className="row">
          {!added.saved && !added.local && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void retry()}>Retry save</button>}
          <Link className="btn btn-primary" to={`/cassettes/${added.cassetteId}/edit`} onClick={onClose}>Open tape</Link>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAdded(undefined)}>Add to another</button>
          <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>Keep exploring</button>
        </div>
      </div> : <>
        <div className="ex-seg" role="radiogroup" aria-label="Tape side">{(['A', 'B'] as const).map((item) => <button key={item} type="button" role="radio" aria-checked={side === item} className={side === item ? 'on' : ''} disabled={busy} onClick={() => setSide(item)}>Side {item}</button>)}</div>
        {sync.listError && <p role="alert">{sync.listError} <button type="button" className="btn btn-secondary" onClick={() => void cassetteStore.refresh()}>Retry library</button></p>}
        {sync.loading && <p role="status">Loading your saved tapes…</p>}{!cassettes.length && !sync.loading && <p className="muted">You don’t have any tapes yet. Start one below.</p>}
        <ul className="ex-tapes">{cassettes.map((cassette) => {
          const fit = tapeFit(cassette, side, song);
          const note = fit.ok ? `${formatTime(fit.remainingSec)} left on side ${side}` : fit.reason === 'duplicate' ? 'Already on this tape' : fit.reason === 'limit' ? '100-track limit reached' : `Only ${formatTime(fit.remainingSec)} left on side ${side}`;
          return <li key={cassette.id}><button type="button" className="ex-tape" onClick={() => void add(cassette.id)} disabled={busy || !fit.ok}>
            <span className="ex-tape-face" aria-hidden="true"><CassetteFace cassette={faceFor(cassette, side)} side={side} width={88} /></span>
            <span className="ex-tape-text"><strong>{cassette.name || 'Untitled'}</strong><small className={fit.ok ? 'muted' : 'ex-tape-warn'}>{note}</small></span>
          </button></li>;
        })}</ul>
        {sync.nextCursor && <button type="button" className="btn btn-secondary" disabled={sync.loading || busy} onClick={() => void cassetteStore.loadMore()}>Load more tapes</button>}
        <label>New tape name<input className="input" value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <button type="button" className="btn btn-primary ex-new-tape" disabled={busy || song.durationSec > 1800 || song.durationSec <= 0} onClick={() => void add()}>+ Create a tape with this song</button>
      </>}
    </div>
  </dialog>;
}
