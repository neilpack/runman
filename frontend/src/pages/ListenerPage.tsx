// A listener's public page (/explore/u/:username): their mixtape on display and the songs
// they've shared, each of which can be added to your own tapes.

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { PublicSong, TapeSide } from '@runman/shared';
import { api, ApiRequestError } from '@/api/client';
import { FlippableFace } from '@/components/cassette/FlippableFace';
import { AddToTapeDialog } from '@/components/explore/AddToTapeDialog';
import { CatalogNote } from '@/components/explore/Listeners';
import { LoadError } from '@/components/explore/LoadError';
import { previewPlayer } from '@/components/explore/previewPlayer';
import { SongList, SongListSkeleton } from '@/components/explore/Songs';
import { Avatar } from '@/components/profile/Avatar';
import { useAccount } from '@/hooks/useAccount';
import { useRemote } from '@/hooks/useRemote';
import '@/components/explore/explore.css';

export function ListenerPage() {
  const { username = '' } = useParams();
  const result = useRemote((signal) => api.listener(username, signal), [username]);
  const { profile: me } = useAccount();
  const [adding, setAdding] = useState<PublicSong | null>(null);
  const [side, setSide] = useState<TapeSide>('A');

  useEffect(() => () => previewPlayer.stop(), []);
  // A different listener starts on side A.
  useEffect(() => setSide('A'), [username]);

  const notFound = result.error instanceof ApiRequestError && result.error.status === 404;
  const page = result.data?.profile.username.toLowerCase() === username.toLowerCase() ? result.data : undefined;

  return (
    <div className="page explore">
      <BackLink />

      {notFound ? (
        <div className="ex-empty">
          <h1 className="ex-missing-title">No listener called @{username}</h1>
          <p className="muted">They may have changed their username, or haven't made their profile public.</p>
          <Link className="btn btn-secondary" to={`/explore?tab=listeners&q=${encodeURIComponent(username)}`}>
            Search listeners
          </Link>
        </div>
      ) : result.error ? (
        <LoadError what={`@${username}`} error={result.error} onRetry={result.retry} />
      ) : !page ? (
        <>
          <h1 className="ex-listener-title">@{username}</h1>
          <SongListSkeleton rows={3} />
        </>
      ) : (
        <>
          <header className="ex-listener-hero">
            <Avatar src={page.profile.avatar} name={page.profile.username} size={80} />
            <div>
              <h1 className="ex-listener-title">@{page.profile.username}</h1>
              <p className="muted">
                {page.songs.length} shared {page.songs.length === 1 ? 'song' : 'songs'}
              </p>
            </div>
          </header>

          {me?.userId === page.profile.userId && (
            <p className="ex-note" role="note">
              This is your public page. Change your picture, username or tape on display from{' '}
              <Link to="/account">your account</Link>.
            </p>
          )}
          <CatalogNote catalog={page.catalog} />

          <div className="ex-listener-grid">
            <section className="card ex-display" aria-labelledby="ex-display-title">
              <h2 id="ex-display-title" className="card-title">On display</h2>
              {page.profile.favoriteTape ? (
                <>
                  <button
                    type="button"
                    className="ex-display-tape"
                    onClick={() => setSide((s) => (s === 'A' ? 'B' : 'A'))}
                    aria-label={`${page.profile.favoriteTape.name || 'Untitled'}, showing side ${side}. Flip the tape.`}
                  >
                    <FlippableFace cassette={page.profile.favoriteTape} side={side} width="100cqw" />
                  </button>
                  <p className="ex-display-meta">
                    <strong>{page.profile.favoriteTape.name || 'Untitled'}</strong>
                    <span className="muted">
                      {' · '}
                      {page.profile.favoriteTape.trackCount}{' '}
                      {page.profile.favoriteTape.trackCount === 1 ? 'song' : 'songs'} · side {side} · tap to flip
                    </span>
                  </p>
                </>
              ) : (
                <p className="muted">@{page.profile.username} hasn't put a tape on display yet.</p>
              )}
            </section>

            <section className="card ex-shared" aria-labelledby="ex-shared-title">
              <h2 id="ex-shared-title" className="card-title">Shared songs</h2>
              {page.songs.length === 0 ? (
                <p className="muted">No public songs yet.</p>
              ) : (
                <SongList songs={page.songs} onAdd={setAdding} showUploader={false} />
              )}
            </section>
          </div>
        </>
      )}

      {adding && <AddToTapeDialog key={adding.id} song={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

/** Goes back (keeping your Explore search) when you came from inside the app; otherwise opens Explore. */
function BackLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const cameFromApp = location.key !== 'default';
  return (
    <Link
      to="/explore?tab=listeners"
      className="ex-back"
      onClick={(e) => {
        if (!cameFromApp) return;
        e.preventDefault();
        void navigate(-1);
      }}
    >
      ← Back to Explore
    </Link>
  );
}
