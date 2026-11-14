// A public tape (/explore/tapes/:id): flip it, preview its songs, and add a copy to your library.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cassetteFromPublicTape, type PublicTapeTrack, type TapeSide } from '@runman/shared';
import { api, ApiRequestError } from '@/api/client';
import { FlippableFace } from '@/components/cassette/FlippableFace';
import { formatTime } from '@/components/cassette/TrackList';
import { LoadError } from '@/components/explore/LoadError';
import { previewPlayer, usePreviewStatus } from '@/components/explore/previewPlayer';
import { listenerPath } from '@/components/explore/Songs';
import { cassetteStore, useCassetteSync } from '@/hooks/useCassettes';
import { useRemote } from '@/hooks/useRemote';
import '@/components/explore/explore.css';

/** Playable URL for a track on a public tape, if it has audio. */
function audioUrlOf(track: PublicTapeTrack): string | undefined {
  if (track.provider === 'explore') return track.hasAudio ? api.publicSongAudioUrl(track.sourceId) : undefined;
  return track.audioUrl;
}

function TrackRow({ tapeId, track, index }: { tapeId: string; track: PublicTapeTrack; index: number }) {
  const key = `${tapeId}:${track.id}`;
  const status = usePreviewStatus(key);
  const url = audioUrlOf(track);
  const playing = status === 'playing' || status === 'loading';
  return (
    <li className="ex-tape-track">
      {url ? (
        <button
          type="button"
          className={`btn btn-secondary ex-tape-play is-${status}`}
          onClick={() => previewPlayer.toggle(key, url)}
          aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`}
          aria-pressed={playing}
        >
          {status === 'error' ? '!' : playing ? '❚❚' : '▶'}
        </button>
      ) : (
        <span className="ex-tape-play muted" title="No audio available" aria-hidden="true">{index + 1}</span>
      )}
      <span className="ex-tape-track-name">
        <strong>{track.title}</strong>
        <small className="muted">{track.artist || 'Unknown artist'}</small>
      </span>
      <span className="muted">{formatTime(track.durationSec)}</span>
    </li>
  );
}

export function PublicTapePage() {
  const { id = '' } = useParams();
  const result = useRemote((signal) => api.publicTape(id, signal), [id]);
  const sync = useCassetteSync();
  const navigate = useNavigate();
  const [side, setSide] = useState<TapeSide>('A');
  const [error, setError] = useState<string>();

  useEffect(() => () => previewPlayer.stop(), []);
  useEffect(() => setSide('A'), [id]);

  const notFound = result.error instanceof ApiRequestError && result.error.status === 404;
  const tape = result.data?.tape.id === id ? result.data.tape : undefined;

  const addToLibrary = () => {
    if (!tape) return;
    setError(undefined);
    try {
      const copy = cassetteStore.create(cassetteFromPublicTape(tape.tape, { communityAudioUrl: api.publicSongAudioUrl }));
      void navigate(`/cassettes/${copy.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This tape could not be added to your library.');
    }
  };

  return (
    <div className="page explore">
      <Link to="/explore?tab=tapes" className="ex-back">← Back to Explore</Link>

      {notFound ? (
        <div className="ex-empty">
          <h1 className="ex-missing-title">This tape isn't on Explore</h1>
          <p className="muted">Its owner may have made it private.</p>
          <Link className="btn btn-secondary" to="/explore?tab=tapes">Browse tapes</Link>
        </div>
      ) : result.error ? (
        <LoadError what="this tape" error={result.error} onRetry={result.retry} />
      ) : !tape ? (
        <p className="muted" role="status">Loading tape…</p>
      ) : (
        <div className="ex-listener-grid">
          <section className="card ex-display" aria-labelledby="ex-tape-title">
            <h1 id="ex-tape-title" className="card-title">{tape.tape.name || 'Untitled'}</h1>
            <button
              type="button"
              className="ex-display-tape"
              onClick={() => setSide((s) => (s === 'A' ? 'B' : 'A'))}
              aria-label={`${tape.tape.name || 'Untitled'}, showing side ${side}. Flip the tape.`}
            >
              <FlippableFace cassette={tape.tape} side={side} width="100cqw" />
            </button>
            <p className="ex-display-meta">
              <span className="muted">
                by <Link to={listenerPath(tape.owner.username)}>@{tape.owner.username}</Link> · side {side} · tap to flip
              </span>
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={addToLibrary} disabled={sync.status === 'hidden'}>
                Add to my library
              </button>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
          </section>

          <section className="card ex-shared" aria-labelledby="ex-tape-tracks">
            <h2 id="ex-tape-tracks" className="card-title">Tracklist</h2>
            {(['A', 'B'] as const).map((s) => {
              const tracks = tape.tape.tracks.filter((t) => t.side === s);
              return (
                <div key={s}>
                  <h3 className="ex-tape-side">Side {s}</h3>
                  {tracks.length === 0 ? (
                    <p className="muted">Nothing on side {s}.</p>
                  ) : (
                    <ol className="ex-tape-tracks">
                      {tracks.map((t, i) => <TrackRow key={t.id} tapeId={tape.id} track={t} index={i} />)}
                    </ol>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
