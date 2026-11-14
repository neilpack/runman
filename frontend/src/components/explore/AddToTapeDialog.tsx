// "Add to tape": pick one of your cassettes (and a side) for a song found on Explore.
// Cassettes are still local (useCassettes), so this writes straight into your library.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { PublicSong, TapeSide } from '@runman/shared';
import { CassetteFace } from '@/components/cassette/CassetteFace';
import { faceFor } from '@/components/cassette/sides';
import { formatTime } from '@/components/cassette/TrackList';
import { cassetteStore, newId, useCassettes } from '@/hooks/useCassettes';
import { tapeFit, trackFromPublicSong } from './addToTape';
import './explore.css';

interface Added {
  cassetteId: string;
  name: string;
  side: TapeSide;
}

export function AddToTapeDialog({ song, onClose }: { song: PublicSong; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cassettes = useCassettes();
  const [side, setSide] = useState<TapeSide>('A');
  const [added, setAdded] = useState<Added | null>(null);

  // No close() on cleanup: unmounting removes the dialog (ending modal mode), and a queued
  // `close` event from StrictMode's dev re-mount would immediately dismiss it.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const addTo = (cassetteId: string) => {
    const tape = cassetteStore.get(cassetteId);
    if (!tape || !tapeFit(tape, side, song).ok) return;
    cassetteStore.update(cassetteId, (c) => ({ tracks: [...c.tracks, trackFromPublicSong(song, side, newId())] }));
    setAdded({ cassetteId, name: tape.name || 'Untitled', side });
  };

  const addToNewTape = () => {
    const tape = cassetteStore.create({ name: 'New Mix', tracks: [trackFromPublicSong(song, 'A', newId())] });
    setAdded({ cassetteId: tape.id, name: tape.name, side: 'A' });
  };

  return (
    <dialog
      ref={ref}
      className="ex-dialog"
      aria-labelledby="ex-dialog-title"
      onClose={onClose}
      // Clicks on the backdrop land on the <dialog> itself; clicks inside land on its content.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="ex-dialog-body">
        <header className="ex-dialog-head">
          <div>
            <h2 id="ex-dialog-title">{added ? 'Added to your tape' : 'Add to a tape'}</h2>
            <p className="muted">
              <strong>{song.title}</strong> · {song.artist} · {formatTime(song.durationSec)}
            </p>
          </div>
          <button type="button" className="ex-icon-btn" onClick={() => ref.current?.close()} aria-label="Close">
            ✕
          </button>
        </header>

        {added ? (
          <div className="ex-dialog-done" role="status">
            <p>
              Recorded onto <strong>{added.name}</strong>, side {added.side}.
            </p>
            <div className="row">
              <Link className="btn btn-primary" to={`/cassettes/${added.cassetteId}/edit`}>
                Open tape
              </Link>
              <button type="button" className="btn btn-secondary" onClick={() => setAdded(null)}>
                Add to another
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>
                Keep exploring
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="ex-seg" role="radiogroup" aria-label="Tape side">
              {(['A', 'B'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={side === s}
                  className={side === s ? 'on' : ''}
                  onClick={() => setSide(s)}
                >
                  Side {s}
                </button>
              ))}
            </div>

            {cassettes.length === 0 ? (
              <p className="muted">You don't have any tapes yet.</p>
            ) : (
              <ul className="ex-tapes">
                {cassettes.map((c) => {
                  const fit = tapeFit(c, side, song);
                  const note = fit.ok
                    ? `${formatTime(fit.remainingSec)} left on side ${side}`
                    : fit.reason === 'duplicate'
                      ? 'Already on this tape'
                      : `Only ${formatTime(fit.remainingSec)} left on side ${side}`;
                  return (
                    <li key={c.id}>
                      <button type="button" className="ex-tape" onClick={() => addTo(c.id)} disabled={!fit.ok}>
                        <span className="ex-tape-face" aria-hidden="true">
                          <CassetteFace cassette={faceFor(c, side)} side={side} width={88} />
                        </span>
                        <span className="ex-tape-text">
                          <strong>{c.name || 'Untitled'}</strong>
                          <small className={fit.ok ? 'muted' : 'ex-tape-warn'}>{note}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <button type="button" className="btn btn-secondary ex-new-tape" onClick={addToNewTape}>
              + Start a new tape with this song
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
